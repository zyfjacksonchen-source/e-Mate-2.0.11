import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parse } from 'yaml'

import {
  BUNDLED_CONNECTOR_SKILLS,
  promotePersistentSkills,
  reconcileBundledConnectorSkills,
  removeManagedSkill,
  resolvePersistentSkillScope,
  throwawayEnvironment,
} from '../lib/emate-safety.js'

const root = new URL('../', import.meta.url)

test('find-skill is pinned and limits persistent installation to connector sources', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  const cli = await readFile(new URL('../lib/cli.js', import.meta.url), 'utf8')
  const tools = await readFile(new URL('../lib/tools.js', import.meta.url), 'utf8')
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const runtime = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.equal(pkg.version, '2.0.12')
  assert.equal(pkg.dsh.upstream.commit, '5a7f18b4535835a81de47c0cc2ca8ceb6e97a4e6')
  assert.match(patch, /cliCommand: 'pnpm dlx skills@1\.5\.22'/u)
  assert.match(patch, /registerFindTool: true/u)
  assert.match(patch, /registerInstallTool: true/u)
  assert.match(patch, /registerRemoveTool: false/u)
  assert.match(patch, /registerCommand: false/u)
  assert.match(tools, /agent: exec\.agent/u)
  assert.doesNotMatch(patch, /\bnpx\b/u)
  assert.match(patch, /tree\/skills-v2\.0\.12-r1\/skills\/connect-feishu-cli/u)
  assert.match(patch, /id: connect-tencent-docs/u)
  assert.match(cli, /subprocess\.spawn/u)
  assert.doesNotMatch(cli, /node:child_process/u)
  assert.doesNotMatch(cli, /\.\.\.process\.env/u)
  assert.match(tools, /Skill installation was cancelled by the user/u)
  assert.match(tools, /id: 'dsh-find-skill-remove'/u)
  assert.match(tools, /resolvePersistentSkillScope\(config, args\.source/u)
  assert.match(tools, /作为设备级全局能力安装/u)
  assert.match(tools, /来源：\$\{args\.source\}/u)
  assert.match(tools, /title: args\.skill \?\? '安装技能'/u)
  assert.match(client, /String\(args\.skill \?\? ["']安装技能["']\)/u)
  assert.doesNotMatch(client, /String\(args\.source/u)
  assert.doesNotMatch(runtime, /^import .* from ['"]yaml['"];?$/mu)

  const config = parse(patch)[0].insert[0].config
  const catalogSources = config.catalogSkills.map(skill => skill.source)
  assert.deepEqual(config.persistentSkillSources, ['larksuite/cli'])
  assert.equal(catalogSources.every(source => source.includes(
    '/zyfjacksonchen-source/e-Mate/tree/skills-v2.0.12-r1/skills/connect-',
  )), true)
})

test('external-connection Skills are global and legacy temporary installs are promoted', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'emate-find-skill-persistent-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const roots = {
    tempSkillDir: join(scratch, 'temp'),
    globalSkillDir: join(scratch, 'global'),
  }
  await writeManagedSkill(roots.tempSkillDir, 'lark-doc', 'temp', 'larksuite/cli')
  await writeManagedSkill(roots.tempSkillDir, 'ordinary-skill', 'temp', 'someone/community')
  const config = { persistentSkillSources: ['larksuite/cli'], installDefaultScope: 'temp' }

  assert.equal(resolvePersistentSkillScope(config, 'larksuite/cli', 'temp'), 'global')
  assert.throws(
    () => resolvePersistentSkillScope(config, 'someone/community', 'global'),
    /not an approved external-connection source/u,
  )
  assert.deepEqual(promotePersistentSkills(config, roots), ['lark-doc'])
  assert.equal((await stat(join(roots.globalSkillDir, 'lark-doc', 'SKILL.md'))).isFile(), true)
  assert.equal(JSON.parse(await readFile(join(roots.globalSkillDir, 'lark-doc', '.dsh-find-skill.json'), 'utf8')).scope, 'global')
  await assert.rejects(stat(join(roots.tempSkillDir, 'lark-doc')), { code: 'ENOENT' })
  assert.equal((await stat(join(roots.tempSkillDir, 'ordinary-skill'))).isDirectory(), true)
})

test('external connection instructions reuse device-global state', async () => {
  const skillsRoot = new URL('../lib/skills/', import.meta.url)
  const documents = await Promise.all([
    'connect-feishu-cli',
    'connect-tencent-docs',
    'connect-dingtalk',
    'connect-wechat-bot',
  ].map(name => readFile(new URL(`${name}/SKILL.md`, skillsRoot), 'utf8')))
  for (const document of documents) {
    assert.match(document, /device-global/u)
    assert.doesNotMatch(document, /current session only|scope appropriate/u)
  }
  assert.match(documents[0], /@larksuite\/cli@1\.0\.88 auth status --json --verify/u)
  assert.doesNotMatch(documents[0], /@larksuite\/cli@latest/u)
  assert.match(documents[0], /A new e-Mate session is never by itself a reason to authorize again/u)
})

test('signed connector instructions replace only recognized predecessors and preserve external auth state', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'emate-find-skill-bundled-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const roots = { globalSkillDir: join(scratch, 'global'), tempSkillDir: join(scratch, 'temp') }
  const authSentinel = join(scratch, '.lark-cli', 'authorization.keep')
  await mkdir(join(scratch, '.lark-cli'), { recursive: true })
  await writeFile(authSentinel, 'device-global-token-state', 'utf8')
  await writeManagedSkill(
    roots.globalSkillDir,
    'connect-feishu-cli',
    'global',
    'https://github.com/zyfjacksonchen-source/e-Mate/tree/skills-v2.0.9-r2/skills/connect-feishu-cli',
    'always run config init --new and auth login',
  )
  const config = connectorConfig()
  const result = reconcileBundledConnectorSkills(config, roots)
  assert.deepEqual(result.updated, ['connect-feishu-cli'])
  assert.deepEqual(result.installed, ['connect-tencent-docs', 'connect-dingtalk', 'connect-wechat-bot'])
  const installed = await readFile(join(roots.globalSkillDir, 'connect-feishu-cli', 'SKILL.md'), 'utf8')
  assert.match(installed, /auth status --json --verify/u)
  assert.doesNotMatch(installed, /always run config init/u)
  const metadata = JSON.parse(await readFile(
    join(roots.globalSkillDir, 'connect-feishu-cli', '.dsh-find-skill.json'),
    'utf8',
  ))
  assert.equal(metadata.source, 'e-mate-bundled:connect-feishu-cli')
  assert.equal(metadata.scope, 'global')
  assert.match(metadata.bundleDigest, /^[a-f0-9]{64}$/u)
  assert.equal(await readFile(authSentinel, 'utf8'), 'device-global-token-state')
  const second = reconcileBundledConnectorSkills(config, roots)
  assert.deepEqual(second.unchanged, BUNDLED_CONNECTOR_SKILLS)
})

test('bundled connector reconciliation restores an interrupted swap and never overwrites an unknown owner', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'emate-find-skill-collision-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const globalSkillDir = join(scratch, 'global')
  const roots = { globalSkillDir, tempSkillDir: join(scratch, 'temp') }
  await writeManagedSkill(globalSkillDir, 'connect-tencent-docs', 'global', 'user/private', 'keep custom owner')
  await writeManagedSkill(
    globalSkillDir,
    '.connect-feishu-cli.e-mate-backup',
    'global',
    'https://github.com/zyfjacksonchen-source/e-Mate/tree/skills-v2.0.9-r2/skills/connect-feishu-cli',
    'recover me',
  )
  await mkdir(join(globalSkillDir, '.connect-feishu-cli.e-mate-staging'), { recursive: true })
  await writeFile(join(globalSkillDir, '.connect-feishu-cli.e-mate-staging', 'partial'), 'partial', 'utf8')
  const result = reconcileBundledConnectorSkills(connectorConfig(), roots)
  assert.deepEqual(result.conflicts, ['connect-tencent-docs'])
  assert.equal(await readFile(join(globalSkillDir, 'connect-tencent-docs', 'SKILL.md'), 'utf8'), 'keep custom owner')
  assert.match(await readFile(join(globalSkillDir, 'connect-feishu-cli', 'SKILL.md'), 'utf8'), /auth status --json --verify/u)
  await assert.rejects(stat(join(globalSkillDir, '.connect-feishu-cli.e-mate-backup')), { code: 'ENOENT' })
  await assert.rejects(stat(join(globalSkillDir, '.connect-feishu-cli.e-mate-staging')), { code: 'ENOENT' })
})

test('find-skill uses the desktop-owned pnpm shim without relying on ambient PATH lookup', async () => {
  const builtCli = await readFile(new URL('../lib/cli.js', import.meta.url), 'utf8')
  assert.match(builtCli, /command === 'pnpm' \? process\.env\.EMATE_DESKTOP_PNPM/u)
  assert.match(builtCli, /!isAbsolute\(managedPnpm\)/u)
  assert.match(builtCli, /argv: \[executable, \.\.\.fixed, \.\.\.args\]/u)
})

test('find-skill CLI receives an isolated environment without host credentials', () => {
  const env = throwawayEnvironment('/tmp/e-mate-find-skill', {
    PATH: '/usr/bin:/bin',
    LANG: 'zh_CN.UTF-8',
    OPENAI_API_KEY: 'secret',
    DEEPSEEK_API_KEY: 'secret',
    EMATE_ENTERPRISE_TOKEN: 'secret',
  })
  assert.equal(env.PATH, '/usr/bin:/bin')
  assert.equal(env.HOME, '/tmp/e-mate-find-skill')
  assert.equal(env.npm_config_cache, '/tmp/e-mate-find-skill/.npm')
  assert.equal(env.OPENAI_API_KEY, undefined)
  assert.equal(env.DEEPSEEK_API_KEY, undefined)
  assert.equal(env.EMATE_ENTERPRISE_TOKEN, undefined)
})

test('skill removal rejects traversal before touching disk', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'emate-find-skill-traversal-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const sentinel = join(scratch, 'sentinel.txt')
  await writeFile(sentinel, 'keep', 'utf8')
  const runtime = fakeRuntime(scratch)
  await assert.rejects(
    removeManagedSkill(runtime.roots, runtime.tempManager, undefined, '../../..', async () => true, runtime.notifyChanged),
    /not a valid managed skill name/u,
  )
  assert.equal((await stat(sentinel)).isFile(), true)
})

test('scope-less removal skips a missing project skill and removes the managed global skill', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'emate-find-skill-global-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const runtime = fakeRuntime(scratch)
  const target = await writeManagedSkill(runtime.globalRoot, 'safe-skill', 'global')
  let confirmed
  const result = await removeManagedSkill(
    runtime.roots,
    runtime.tempManager,
    undefined,
    'safe-skill',
    async value => { confirmed = value; return true },
    runtime.notifyChanged,
  )
  assert.deepEqual(result, { removed: true, name: 'safe-skill', scope: 'global' })
  assert.deepEqual(confirmed, { name: 'safe-skill', scope: 'global', path: target })
  await assert.rejects(stat(target), { code: 'ENOENT' })
  assert.equal(runtime.notifications, 1)
})

test('skill removal keeps the exact managed directory when confirmation is rejected', async (t) => {
  const scratch = await mkdtemp(join(tmpdir(), 'emate-find-skill-cancel-'))
  t.after(() => rm(scratch, { recursive: true, force: true }))
  const runtime = fakeRuntime(scratch)
  const target = await writeManagedSkill(join(runtime.projectRoot, '.managed'), 'keep-skill', 'project')
  await assert.rejects(
    removeManagedSkill(runtime.roots, runtime.tempManager, 'project', 'keep-skill', async () => false, runtime.notifyChanged),
    /cancelled by the user/u,
  )
  assert.equal((await stat(target)).isDirectory(), true)
  assert.equal(runtime.notifications, 0)
})

function fakeRuntime(scratch) {
  const projectRoot = join(scratch, 'project')
  const globalRoot = join(scratch, 'global')
  const tempRoot = join(scratch, 'temp')
  const runtime = {
    projectRoot,
    globalRoot,
    tempRoot,
    notifications: 0,
    tempManager: { list: () => [], remove: async () => false },
  }
  runtime.roots = { projectSkillDir: join(projectRoot, '.managed'), globalSkillDir: globalRoot, tempSkillDir: tempRoot }
  runtime.notifyChanged = () => { runtime.notifications += 1 }
  return runtime
}

function connectorConfig() {
  return {
    catalogSkills: BUNDLED_CONNECTOR_SKILLS.map(name => ({
      id: name,
      source: `https://github.com/zyfjacksonchen-source/e-Mate/tree/skills-v2.0.12-r1/skills/${name}`,
    })),
  }
}

async function writeManagedSkill(root, name, scope, source = 'test/source', content) {
  const target = join(root, name)
  await mkdir(target, { recursive: true })
  await writeFile(
    join(target, 'SKILL.md'),
    content ?? `---\nname: ${name}\ndescription: test skill\n---\nbody\n`,
    'utf8',
  )
  await writeFile(join(target, '.dsh-find-skill.json'), JSON.stringify({
    source,
    installedAt: Date.now(),
    scope,
  }), 'utf8')
  return target
}
