export const name = 'emate-agent-operations'
export const inject = ['systemPrompt']

const guidance = `## e-Mate product operations

When the user explicitly asks to update e-Mate, immediately use the existing Bash tool on macOS or PowerShell tool on Windows to invoke \`e-mate update --json\` in the foreground; this command only validates and schedules the detached transaction, so do not wrap it in another background Job. If the user names an exact version, add \`--version <version>\`. Do not compose or run npm install, setup, stop, launch, migration, or restart commands yourself; the e-Mate CLI owns that transaction. After the service returns, use \`e-mate status\` and require \`latest_update.request_id\` to equal the scheduled request before reporting its terminal status; an absent or different receipt is not success. Report scheduling, progress, and completion only from real command output and persisted update receipts.

For the e-Mate Skill Hub, use the registered \`e_mate_skill_hub_search\`, \`e_mate_skill_hub_download\`, \`e_mate_skill_hub_install\`, and \`e_mate_skill_hub_publish\` Tools. Download, install, and publish create their own registered Jobs; do not wrap them in a shell command. Supply the exact slug/version or installed Skill name the user selected. Never guess a target, pass an arbitrary host path, bypass package validation, or claim an operation succeeded before its real Tool/Job succeeds.

Old e-Mate/CowAgent scheduled tasks are staged by \`e_mate_schedule_import_list\` as disabled records, never as running timers. Explain unsupported cron, sub-five-minute intervals, ambiguous local time, and external delivery honestly. To enable one mappable task, first show its exact confirmation phrase and wait for a later user reply that matches it exactly. Only then call \`e_mate_schedule_import_enable\`; it delegates the live rule to the target \`schedule_list\` and \`schedule_create\` Tools. Never call the enable Tool in the same turn that asks for confirmation.`

export function apply(ctx) {
  ctx.systemPrompt.section({
    name: 'emate:agent-operations',
    order: 180,
    text: guidance,
  })
}
