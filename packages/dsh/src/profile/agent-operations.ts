import { basename, join } from 'node:path'
import { loadTargetSchedule } from './target-runtime.js'

export const name = 'emate-agent-operations'
export const inject = ['systemPrompt', 'connection', 'sessionPersistence']
export const SCHEDULES_CHANNEL = '/emate.schedules'

const brandIdentity = '你是小芯，用户的 AI 办公助手。你运行在 e-Mate 内，是亦芯开发的全场景办公 AI Agent。自我介绍时使用第一人称：“我是小芯，你的 AI 办公助手。我运行在 e-Mate 内，是亦芯开发的全场景办公 AI Agent。”'

const guidance = `## e-Mate product operations

${brandIdentity} 涉及自我介绍、产品身份或品牌归属时必须保持此身份，不得自称 DeepSeek Harness、Codex 或其他产品。

When the user explicitly asks to update e-Mate, immediately use the existing Bash tool on macOS or PowerShell tool on Windows to invoke \`e-mate update --json\` in the foreground; this command only validates and schedules the detached transaction, so do not wrap it in another background Job. If the user names an exact version, add \`--version <version>\`. Do not compose or run npm install, setup, stop, launch, migration, or restart commands yourself; the e-Mate CLI owns that transaction. After the service returns, use \`e-mate status\` and require \`latest_update.request_id\` to equal the scheduled request before reporting its terminal status; an absent or different receipt is not success. Report scheduling, progress, and completion only from real command output and persisted update receipts.

For the e-Mate Skill Hub, use the registered \`e_mate_skill_hub_search\`, \`e_mate_skill_hub_download\`, \`e_mate_skill_hub_install\`, and \`e_mate_skill_hub_publish\` Tools. Download, install, and publish create their own registered Jobs; do not wrap them in a shell command. Supply the exact slug/version or installed Skill name the user selected. Never guess a target, pass an arbitrary host path, bypass package validation, or claim an operation succeeded before its real Tool/Job succeeds.

When the user asks for an external service that is not installed, use the installed find-skill provider to discover a suitable Skill and let its native confirmation install it. If that Skill requires MCP, use \`mcp_manage\` for the connection and authorization flow. Do not invent a built-in connector, do not ask the user to paste secrets into chat, and do not claim a connector is effective until \`mcp_manage\` reports \`active=true\`. Browser Tools are only for operating a user-visible page after dsh-browser is connected.

Old e-Mate/CowAgent scheduled tasks are staged by \`e_mate_schedule_import_list\` as disabled records, never as running timers. Explain unsupported cron, sub-five-minute intervals, ambiguous local time, and external delivery honestly. To enable one mappable task, first show its exact confirmation phrase and wait for a later user reply that matches it exactly. Only then call \`e_mate_schedule_import_enable\`; it delegates the live rule to the target \`schedule_list\` and \`schedule_create\` Tools. Never call the enable Tool in the same turn that asks for confirmation.`

export function apply(ctx, config = {}) {
  ctx.systemPrompt.section({
    name: 'emate:agent-operations',
    order: 180,
    text: guidance,
  })
  const cached = new Map()
  ctx.effect(() => ctx.connection.rpc.handle(SCHEDULES_CHANNEL, async (endpoint, payload) => {
    if (endpoint !== 'list' || payload === null || typeof payload !== 'object'
      || Array.isArray(payload) || Object.keys(payload).length !== 0) {
      return { ok: false, error: { code: 'bad-request', message: 'unknown e-Mate schedules endpoint', details: { issues: [] } } }
    }
    try {
      const snapshots = await ctx.sessionPersistence.listSnapshots()
      const currentIds = new Set(snapshots.map(snapshot => String(snapshot.header.id)))
      for (const id of cached.keys()) if (!currentIds.has(id)) cached.delete(id)
      const schedule = await loadTargetSchedule(config.bindingPath ?? join(import.meta.dirname, 'runtime-binding.json'))
      const now = Date.now()
      const project = value => value.error === undefined ? {
        items: value.active.map(record => ({
          session_id: value.sessionId,
          session_title: value.title,
          ...schedule.scheduleView(record, now),
        })),
      } : value
      const results = await Promise.all(snapshots.map(async snapshot => {
        const id = String(snapshot.header.id)
        const hit = cached.get(id)
        if (hit?.revision === snapshot.revision) return project(hit.value)
        try {
          const inspection = await ctx.sessionPersistence.inspect(snapshot.header.id)
          const folded = schedule.foldScheduleEvents(inspection.events, inspection.meta.seedLength ?? 0)
          const titleEvent = inspection.events.findLast(event => event.type === 'session/title')
          const title = typeof titleEvent?.data?.title === 'string' && titleEvent.data.title.trim() !== ''
            ? titleEvent.data.title.trim()
            : basename(inspection.meta.cwd || '') || id
          const value = {
            sessionId: id,
            title,
            active: folded.active,
          }
          cached.set(id, { revision: snapshot.revision, value })
          return project(value)
        } catch {
          const value = { items: [], error: { session_id: id, message: '该会话的定时任务日志无法读取。' } }
          cached.set(id, { revision: snapshot.revision, value })
          return value
        }
      }))
      return {
        ok: true,
        value: {
          schema_version: 1,
          items: results.flatMap(result => result.items).sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt)),
          errors: results.flatMap(result => result.error === undefined ? [] : [result.error]),
        },
      }
    } catch {
      return { ok: false, error: { code: 'unavailable', message: '定时任务暂时无法读取。', details: { issues: [] } } }
    }
  }, { authority: 'loopback' }), 'emate.agentOperations: native schedule projection')
}
