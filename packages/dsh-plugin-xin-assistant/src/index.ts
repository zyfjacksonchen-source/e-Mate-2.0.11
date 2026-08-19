import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { delimiter } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-subprocess'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import { buildCliArgs, resolvePythonCommand } from './args.ts'

export { buildCliArgs, resolvePythonCommand } from './args.ts'

export const name = '@e-mate/dsh-plugin-xin-assistant'
export const inject = ['subprocess', 'tools', 'systemPrompt']
export const CLI_SHA256 = '936c5a16ada2d59144b39848535f4ab36d0fb87b07665955513d20abc0606767'

const runtimeRoot = fileURLToPath(new URL('../runtime/', import.meta.url))
const cliPath = fileURLToPath(new URL('../runtime/xin_agent_cli.py', import.meta.url))
const vendorRoot = fileURLToPath(new URL('../runtime/vendor/', import.meta.url))
const nativeVendorRoot = fileURLToPath(new URL(`../runtime/vendor-native/${process.platform}-${process.arch}/`, import.meta.url))

export interface ConfigShape { pythonPath: string; databasePath: string }
export const Config: Schema<ConfigShape> = z.object({
  pythonPath: z.string().default(''),
  databasePath: z.string().default(''),
})

export function verifyBundledCli(): void {
  const digest = createHash('sha256').update(readFileSync(cliPath)).digest('hex')
  if (digest !== CLI_SHA256) throw new Error('芯助手 CLI 文件完整性校验失败。')
}

export function apply(ctx: Context, config: ConfigShape): void {
  verifyBundledCli()
  const python = resolvePythonCommand(config.pythonPath, launchEnvironmentOf(ctx))
  ctx.systemPrompt.section({
    name: 'emate:xin-assistant',
    order: 182,
    text: 'Use xin_assistant_cli for read-only Xin Assistant account, project, task, report, note, realtime, and sync-state queries. Never use shell for the Xin Assistant CLI and never request or print tokens.',
  })
  ctx.tools.register(defineTool({
    name: 'xin_assistant_cli',
    description: 'Run one structured, read-only Xin Assistant CLI query through the DSH subprocess boundary.',
    parameters: {
      operation: { type: 'string', required: true, enum: ['schema', 'auth_status', 'account_list', 'project_list', 'project_detail', 'task_list', 'task_detail', 'user_list', 'report_summary', 'note_detail', 'snapshot', 'realtime_summary', 'sync_state', 'sync_changes'] },
      source: { type: 'string', enum: ['cache', 'mpi'] }, platform: { type: 'string', enum: ['xhs', 'bili', 'alipay'] },
      xhs_channel: { type: 'string', enum: ['all', 'spotlight', 'chengfeng'] }, start_date: { type: 'string' }, end_date: { type: 'string' },
      project_id: { type: 'integer' }, task_id: { type: 'integer' }, account_id: { type: 'string' }, search: { type: 'string' }, operator: { type: 'string' },
      status: { type: 'string' }, category: { type: 'string' }, assignee: { type: 'string' }, user_role: { type: 'string' }, department: { type: 'string' }, since: { type: 'string' },
      limit: { type: 'integer' }, offset: { type: 'integer' }, full: { type: 'boolean' }, include_archived: { type: 'boolean' }, include_resigned: { type: 'boolean' },
    },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const argv = [python, cliPath, ...buildCliArgs(args)]
      const signal = AbortSignal.any([exec.signal, AbortSignal.timeout(60_000)])
      const handle = ctx.subprocess.spawn({
        argv, cwd: runtimeRoot, signal, graceMs: 3_000,
        env: {
          PYTHONPATH: `${vendorRoot}${delimiter}${nativeVendorRoot}`,
          ...(config.databasePath.trim() === '' ? {} : { XIN_AGENT_DATABASE: config.databasePath.trim() }),
        },
        stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 * 1024 }, stderr: { maxBytes: 64 * 1024 } },
      })
      const outcome = await handle.done
      const stdout = handle.collected.stdout?.readFrom(0)
      const stderr = handle.collected.stderr?.readFrom(0)
      if (signal.aborted) throw new Error(exec.signal.aborted ? '芯助手 CLI 已取消。' : '芯助手 CLI 执行超时。')
      if (stdout === undefined || stdout.lossy) throw new Error('芯助手 CLI 输出超过安全上限。')
      let value: unknown
      try { value = JSON.parse(stdout.text) } catch { throw new Error(`芯助手 CLI 返回了无效 JSON：${stderr?.text.trim() || '无详情'}`) }
      if (outcome.exitCode !== 0) {
        const message = typeof value === 'object' && value !== null && 'error' in value
          ? JSON.stringify((value as { error: unknown }).error)
          : stderr?.text.trim() || '无详情'
        throw new Error(`芯助手 CLI 查询失败：${message}`)
      }
      return value
    },
  }))
}
