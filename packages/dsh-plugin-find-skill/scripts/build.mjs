import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const upstream = resolve(root, '../../upstream/plugins/dsh-find-skill')
const harness = resolve(root, '../../upstream/deepseek-harness')
const run = (cwd, ...args) => {
  const result = spawnSync('pnpm', args, { cwd, encoding: 'utf8', stdio: 'pipe' })
  if (result.status !== 0) throw new Error(`${args.join(' ')} failed:\n${result.stdout}${result.stderr}`)
}
const bundleRuntime = () => {
  const result = spawnSync(process.execPath, [
    resolve(harness, 'node_modules/tsdown/dist/run.mjs'),
    '--config', join(root, 'tsdown.runtime.config.ts'),
  ], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
  if (result.status !== 0) throw new Error(`runtime bundle failed:\n${result.stdout}${result.stderr}`)
}

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before)
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) {
    throw new Error(`generated find-skill ${label} is not uniquely patchable`)
  }
  return `${source.slice(0, first)}${after}${source.slice(first + before.length)}`
}

function replaceSection(source, start, end, replacement, label) {
  const from = source.indexOf(start)
  const to = from < 0 ? -1 : source.indexOf(end, from + start.length)
  if (from < 0 || to < 0 || source.indexOf(start, from + start.length) >= 0) {
    throw new Error(`generated find-skill ${label} is not uniquely patchable`)
  }
  return `${source.slice(0, from)}${replacement}${source.slice(to)}`
}

run(upstream, 'install', '--frozen-lockfile', '--config.minimumReleaseAge=0')
run(upstream, 'build')
run(join(upstream, 'client'), 'build')
await rm(join(root, 'lib'), { recursive: true, force: true })
await cp(join(upstream, 'lib'), join(root, 'lib'), { recursive: true })
await cp(join(root, 'overrides/emate-safety.mjs'), join(root, 'lib/emate-safety.js'))
await mkdir(join(root, 'lib/types/client'), { recursive: true })
await cp(join(upstream, 'client/lib/client.js'), join(root, 'lib/client.js'))
await cp(join(upstream, 'client/lib/types/index.d.ts'), join(root, 'lib/types/client/index.d.ts'))
let client = await readFile(join(root, 'lib/client.js'), 'utf8')
client = client.replaceAll('dsh-find-skill-client', '@e-mate/dsh-plugin-find-skill')
await writeFile(join(root, 'lib/client.js'), client)
const cliPath = join(root, 'lib/cli.js')
let cli = await readFile(cliPath, 'utf8')
const imports = `import { join } from 'node:path';`
const command = `    const [command, ...fixed] = tokens;\n    const handle = subprocess.spawn({\n        argv: [command, ...fixed, ...args],`
cli = replaceExactlyOnce(cli, imports, `import { isAbsolute, join } from 'node:path';\nimport { throwawayEnvironment } from "./emate-safety.js";`, 'CLI imports')
cli = replaceExactlyOnce(cli, command, `    const [command, ...fixed] = tokens;\n    const managedPnpm = command === 'pnpm' ? process.env.EMATE_DESKTOP_PNPM : undefined;\n    if (managedPnpm !== undefined && !isAbsolute(managedPnpm))\n        throw new Error('EMATE_DESKTOP_PNPM must be an absolute path');\n    const executable = managedPnpm ?? command;\n    const handle = subprocess.spawn({\n        argv: [executable, ...fixed, ...args],`, 'CLI command')
cli = replaceSection(
  cli,
  'function throwawayEnv(home) {',
  '/**\n * Fetch one skill',
  'function throwawayEnv(home) {\n    return throwawayEnvironment(home, process.env);\n}\n',
  'CLI environment',
)
await writeFile(cliPath, cli)

const installPath = join(root, 'lib/install.js')
let install = await readFile(installPath, 'utf8')
install = replaceExactlyOnce(
  install,
  `import { join } from 'node:path';`,
  `import { join } from 'node:path';\nimport { removeManagedSkill } from "./emate-safety.js";`,
  'remove imports',
)
install = replaceSection(
  install,
  'export async function removeSkill(',
  '/**\n * Update a managed skill',
  `export async function removeSkill(provider, tempManager, scope, name, cwd, confirm) {
    return removeManagedSkill(resolveRoots(providerConfigOf(provider), cwd), tempManager, scope, name, confirm, () => provider.notifyChanged());
}
`,
  'remove implementation',
)
await writeFile(installPath, install)

const installTypesPath = join(root, 'lib/install.d.ts')
let installTypes = await readFile(installTypesPath, 'utf8')
installTypes = replaceExactlyOnce(
  installTypes,
  `export declare function removeSkill(provider: ManagedSkillProvider, tempManager: TempSkillManager, scope: InstallScope | undefined, name: string, cwd?: string): Promise<RemoveResult>;`,
  `export interface RemoveTarget {\n    readonly name: string;\n    readonly scope: InstallScope;\n    readonly path: string;\n}\nexport type ConfirmSkillRemoval = (target: RemoveTarget) => Promise<boolean>;\nexport declare function removeSkill(provider: ManagedSkillProvider, tempManager: TempSkillManager, scope: InstallScope | undefined, name: string, cwd: string | undefined, confirm: ConfirmSkillRemoval): Promise<RemoveResult>;`,
  'remove types',
)
await writeFile(installTypesPath, installTypes)

const commandPath = join(root, 'lib/command.js')
let commandSource = await readFile(commandPath, 'utf8')
commandSource = replaceExactlyOnce(
  commandSource,
  `const result = await removeSkill(provider, tempManager, parsed.scope, parsed.arg, cwd);`,
  `const result = await removeSkill(provider, tempManager, parsed.scope, parsed.arg, cwd, async () => true);`,
  'slash-command removal',
)
await writeFile(commandPath, commandSource)

const toolsPath = join(root, 'lib/tools.js')
let toolsSource = await readFile(toolsPath, 'utf8')
toolsSource = replaceExactlyOnce(
  toolsSource,
  `            async execute(args, exec) {\n                return removeSkill(provider, tempManager, parseScope(args.scope), args.name, exec.agent?.session.header.cwd);\n            },`,
  `            async execute(args, exec) {\n                return removeSkill(provider, tempManager, parseScope(args.scope), args.name, exec.agent?.session.header.cwd, async (target) => {\n                    const userQuestions = ctx.get('userQuestions');\n                    const answer = await userQuestions.ask({\n                        agent: exec.agent,\n                        questions: [{\n                                id: 'dsh-find-skill-remove',\n                                question: '是否删除 ' + target.name + '（' + target.scope + '）？\\n' + target.path,\n                                header: '删除技能',\n                                options: [\n                                    { label: '删除', description: '删除这个插件管理的技能目录。' },\n                                    { label: '取消', description: '保留当前技能。' },\n                                ],\n                            }],\n                    });\n                    return answer.answers[0]?.selected.includes('删除') === true;\n                });\n            },`,
  'tool removal',
)
await writeFile(toolsPath, toolsSource)
bundleRuntime()
await writeFile(join(root, 'lib/index.js'), await readFile(join(root, '.runtime-bundle/index.js')))
await rm(join(root, '.runtime-bundle'), { recursive: true, force: true })
await cp(join(upstream, 'LICENSE'), join(root, 'LICENSE'))
