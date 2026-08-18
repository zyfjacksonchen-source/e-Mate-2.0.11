import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('find-skill adapter is pinned, user-confirmed, and uses the native subprocess seam', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  const cli = await readFile(new URL('../../upstream/plugins/dsh-find-skill/src/cli.ts', root), 'utf8')
  const tools = await readFile(new URL('../../upstream/plugins/dsh-find-skill/src/tools.ts', root), 'utf8')
  const client = await readFile(new URL('../../upstream/plugins/dsh-find-skill/client/src/client/index.ts', root), 'utf8')
  assert.equal(pkg.version, '2.0.9')
  assert.equal(pkg.dsh.upstream.commit, '5a7f18b4535835a81de47c0cc2ca8ceb6e97a4e6')
  assert.match(patch, /cliCommand: 'pnpm dlx skills@1\.5\.22'/u)
  assert.match(tools, /agent: exec\.agent/u)
  assert.doesNotMatch(patch, /\bnpx\b/u)
  assert.match(patch, /tree\/skills-v2\.0\.9-r5\/skills\/connect-feishu-cli/u)
  assert.match(patch, /id: connect-tencent-docs/u)
  assert.match(cli, /subprocess\.spawn/u)
  assert.doesNotMatch(cli, /node:child_process/u)
  assert.match(tools, /Skill installation was cancelled by the user/u)
  assert.match(tools, /question: `是否安装 \$\{args\.skill \?\? '所选技能'\}/u)
  assert.match(tools, /title: args\.skill \?\? '安装技能'/u)
  assert.match(client, /String\(args\.skill \?\? '安装技能'\)/u)
  assert.doesNotMatch(client, /String\(args\.source/u)
})
