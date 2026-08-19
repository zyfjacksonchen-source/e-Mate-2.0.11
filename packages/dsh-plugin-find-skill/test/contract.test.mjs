import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { removeManagedSkill, throwawayEnvironment } from '../lib/emate-safety.js'

const root = new URL('../', import.meta.url)

test('find-skill adapter is pinned, user-confirmed, and uses the native subprocess seam', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  const cli = await readFile(new URL('../lib/cli.js', import.meta.url), 'utf8')
  const tools = await readFile(new URL('../lib/tools.js', import.meta.url), 'utf8')
  const client = await readFile(new URL('../lib/client.js', import.meta.url), 'utf8')
  const runtime = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.equal(pkg.version, '2.0.11')
  assert.equal(pkg.dsh.upstream.commit, '5a7f18b4535835a81de47c0cc2ca8ceb6e97a4e6')
  assert.match(patch, /cliCommand: 'pnpm dlx skills@1\.5\.22'/u)
  assert.match(tools, /agent: exec\.agent/u)
  assert.doesNotMatch(patch, /\bnpx\b/u)
  assert.match(patch, /tree\/skills-v2\.0\.9-r5\/skills\/connect-feishu-cli/u)
  assert.match(patch, /id: connect-tencent-docs/u)
  assert.match(cli, /subprocess\.spawn/u)
  assert.doesNotMatch(cli, /node:child_process/u)
  assert.doesNotMatch(cli, /\.\.\.process\.env/u)
  assert.match(tools, /Skill installation was cancelled by the user/u)
  assert.match(tools, /id: 'dsh-find-skill-remove'/u)
  assert.match(tools, /question: `是否安装 \$\{args\.skill \?\? '所选技能'\}/u)
  assert.match(tools, /title: args\.skill \?\? '安装技能'/u)
  assert.match(client, /String\(args\.skill \?\? ["']安装技能["']\)/u)
  assert.doesNotMatch(client, /String\(args\.source/u)
  assert.doesNotMatch(runtime, /^import .* from ['"]yaml['"];?$/mu)
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

async function writeManagedSkill(root, name, scope) {
  const target = join(root, name)
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'SKILL.md'), `---\nname: ${name}\ndescription: test skill\n---\nbody\n`, 'utf8')
  await writeFile(join(target, '.dsh-find-skill.json'), JSON.stringify({
    source: 'test/source',
    installedAt: Date.now(),
    scope,
  }), 'utf8')
  return target
}
