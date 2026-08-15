import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const name = 'emate-general-workspace'
export const inject = ['workspaceRegistry']

export async function apply(ctx: any, config: { dshHome?: string } = {}) {
  const dshHome = resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))
  const path = join(dshHome, 'e-mate', 'general')
  await mkdir(path, { recursive: true })
  await ctx.workspaceRegistry.create(path, '通用会话')
}
