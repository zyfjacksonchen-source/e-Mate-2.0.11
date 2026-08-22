import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const upstream = resolve(root, '../../upstream/plugins/dsh-computer-use')
const harness = resolve(root, '../../upstream/deepseek-harness')
const readText = async path => (await readFile(path, 'utf8')).replaceAll('\r\n', '\n')
const bundleRuntime = () => {
  const result = spawnSync(process.execPath, [
    resolve(harness, 'node_modules/tsdown/dist/run.mjs'),
    '--config', join(root, 'tsdown.runtime.config.ts'),
  ], { cwd: root, encoding: 'utf8', stdio: 'pipe' })
  if (result.status !== 0) throw new Error(`runtime bundle failed:\n${result.stdout}${result.stderr}`)
}

for (const name of ['lib', 'assets', 'docs']) {
  await rm(join(root, name), { recursive: true, force: true })
  await cp(join(upstream, name), join(root, name), { recursive: true })
}
if (process.platform === 'darwin') {
  await rm(join(root, 'native'), { recursive: true, force: true })
  await cp(join(upstream, 'native'), join(root, 'native'), { recursive: true })
}
await mkdir(join(root, 'scripts'), { recursive: true })
await cp(join(upstream, 'scripts/build-native.mjs'), join(root, 'scripts/build-native.mjs'))
await cp(join(upstream, 'LICENSE'), join(root, 'LICENSE'))
if (process.platform === 'darwin') {
  const helper = join(root, 'native/macos/bin/dsh-computer-use-helper')
  const nativeManifestPath = join(root, 'native/macos/manifest.json')
  const nativeManifest = JSON.parse(await readFile(nativeManifestPath, 'utf8'))
  nativeManifest.binary.sha256 = createHash('sha256').update(await readFile(helper)).digest('hex')
  await writeFile(nativeManifestPath, `${JSON.stringify(nativeManifest, null, 2)}\n`)
}
let client = await readText(join(root, 'lib/client.js'))
client = client.replaceAll('@anionex/dsh-computer-use', '@e-mate/dsh-plugin-computer-use')
await writeFile(join(root, 'lib/client.js'), client)

function replaceExactlyOnce(source, before, after, label) {
  const count = source.split(before).length - 1
  if (count !== 1) throw new Error(`computer-use adapter expected one ${label} seam, found ${count}`)
  return source.replace(before, after)
}
const exposurePath = join(root, 'lib/exposure.js')
let exposure = await readText(exposurePath)
exposure = replaceExactlyOnce(
  exposure,
  `import { defineTool } from '@deepseek-ai/dsh-tools';`,
  `import { defineTool } from '@deepseek-ai/dsh-tools';
import { hasExplicitComputerUseRequest } from './emate-explicit.js';`,
  'explicit Computer Use request import',
)
exposure = replaceExactlyOnce(
  exposure,
  `                if (!hasLoadedComputerUseSkill(exec.agent.session)) {
                    throw new Error(\`${'${COMPUTER_USE_ACTIVATE}'}: load the ${'${COMPUTER_USE_SKILL_NAME}'} Skill first\`);
                }
                return Promise.resolve(this.activate(exec.agent));`,
  `                if (!hasExplicitComputerUseRequest(exec.agent.session)) {
                    throw new Error(\`${'${COMPUTER_USE_ACTIVATE}'}: the current user request must explicitly select @电脑操控\`);
                }
                if (!hasLoadedComputerUseSkill(exec.agent.session)) {
                    throw new Error(\`${'${COMPUTER_USE_ACTIVATE}'}: load the ${'${COMPUTER_USE_SKILL_NAME}'} Skill first\`);
                }
                return Promise.resolve(this.activate(exec.agent));`,
  'activation Tool request guard',
)
exposure = replaceExactlyOnce(
  exposure,
  `            this.ctx.on('agent/disposed', ({ agent }) => { this.detach(agent); }),
            this.ctx.tools.guard((exec) => {
                if (exec.name !== 'bash'`,
  `            this.ctx.on('agent/disposed', ({ agent }) => { this.detach(agent); }),
            this.ctx.tools.guard((exec) => {
                if (exec.agent === undefined || hasExplicitComputerUseRequest(exec.agent.session))
                    return undefined;
                const state = this.states.get(exec.agent);
                if (state === undefined || !state.toolNames.includes(exec.name))
                    return undefined;
                return 'Computer Use is available only when the current user request explicitly inserts @电脑操控. Use CDP browser tools first for webpage tasks.';
            }),
            this.ctx.tools.guard((exec) => {
                if (exec.name !== 'bash'`,
  'execution Tool request guard',
)
exposure = replaceExactlyOnce(
  exposure,
  `                    && exec.agent !== undefined
                    && isSkillArguments(exec.arguments)`,
  `                    && exec.agent !== undefined
                    && hasExplicitComputerUseRequest(exec.agent.session)
                    && isSkillArguments(exec.arguments)`,
  'Skill-result activation guard',
)
exposure = replaceExactlyOnce(
  exposure,
  `        if (hasLoadedComputerUseSkill(agent.session))
            this.activate(agent);`,
  `        if (hasExplicitComputerUseRequest(agent.session) && hasLoadedComputerUseSkill(agent.session))
            this.activate(agent);`,
  'existing Agent adoption guard',
)
await writeFile(exposurePath, exposure)

await writeFile(join(root, 'lib/emate-explicit.js'), `// Direct activation remains user-visible; the legacy marker is accepted only when replaying old user history.
const LEGACY_MARKER = '<computer-use explicit="true">'
const DIRECT_TRIGGER = /^\\s*@电脑操控(?:\\s|$)/u
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
/** Whether the latest direct user request explicitly selected Computer Use. */
export function hasExplicitComputerUseRequest(session) {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index]
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
    return event.data.content.some(block => isRecord(block)
      && block.type === 'text'
      && typeof block.text === 'string'
      && (DIRECT_TRIGGER.test(block.text) || block.text.includes(LEGACY_MARKER)))
  }
  return false
}
`)

const skillPath = join(root, 'lib/skill.js')
let skill = await readText(skillPath)
skill = replaceExactlyOnce(
  skill,
  `export const COMPUTER_USE_SKILL_CONTENT = \`# DSH Computer Use

Use this capability only for a local macOS application UI that has no narrower,`,
  `export const COMPUTER_USE_SKILL_CONTENT = \`# DSH Computer Use

This capability is enabled only when the current direct user request contains the
e-Mate @电脑操控 trigger. Never enable or invoke it on the model's own initiative.
For every webpage read or operation, use the CDP browser tools first.

Use this capability only for a local macOS application UI that has no narrower,`,
  'Computer Use Skill selection rule',
)
await writeFile(skillPath, skill)

const indexPath = join(root, 'lib/index.js')
bundleRuntime()
let runtime = await readText(join(root, '.runtime-bundle/index.js'))
runtime = replaceExactlyOnce(runtime, 'new URL("../../native/macos/", import.meta.url)', 'new URL("../native/macos/", import.meta.url)', 'bundled native path')
runtime = replaceExactlyOnce(runtime, 'new URL("../../scripts/build-native.mjs", import.meta.url)', 'new URL("../scripts/build-native.mjs", import.meta.url)', 'bundled native builder path')
await writeFile(indexPath, runtime)
await rm(join(root, '.runtime-bundle'), { recursive: true, force: true })
