import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { hasExplicitComputerUseRequest } from '../lib/emate-explicit.js'

const root = new URL('../', import.meta.url)

test('computer-use adapter preserves the immutable universal helper only on macOS', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  const nativeBuilder = await readFile(new URL('scripts/build-native.mjs', root), 'utf8')
  const adapterBuilder = await readFile(new URL('scripts/build.mjs', root), 'utf8')
  const client = await readFile(new URL('lib/client.js', root), 'utf8')
  const leases = await readFile(new URL('lib/leases.js', root), 'utf8')
  const upstreamLeases = await readFile(new URL('../../upstream/plugins/dsh-computer-use/lib/leases.js', root), 'utf8')
  const bundle = await readFile(new URL('lib/index.js', root), 'utf8')
  assert.equal(pkg.version, '2.0.11')
  assert.equal(pkg.dsh.upstream.commit, '76bfe8607f61945c1cbb84e73976e601100c13a2')
  assert.equal(pkg.eMate.harnessVersion, '0.1.0-rc.7')
  assert.match(patch, /process\.platform !== 'darwin'/u)
  assert.doesNotMatch(patch, /allowAllApps:\s*true/u)
  if (process.platform === 'darwin') {
    const manifest = JSON.parse(await readFile(new URL('native/macos/manifest.json', root), 'utf8'))
    const helper = await readFile(new URL('native/macos/bin/dsh-computer-use-helper', root))
    assert.deepEqual(manifest.binary.architectures, ['arm64', 'x86_64'])
    assert.equal(createHash('sha256').update(helper).digest('hex'), manifest.binary.sha256)
    const verified = spawnSync('/usr/bin/codesign', ['--verify', '--strict', new URL('native/macos/bin/dsh-computer-use-helper', root).pathname], { encoding: 'utf8' })
    assert.equal(verified.status, 0, verified.stderr)
    const signature = spawnSync('/usr/bin/codesign', ['-dvv', new URL('native/macos/bin/dsh-computer-use-helper', root).pathname], { encoding: 'utf8' })
    assert.match(`${signature.stdout}\n${signature.stderr}`, /Signature=adhoc/u)
  }
  assert.doesNotMatch(nativeBuilder, /HELPER_ENTITLEMENTS|--entitlements|allow-jit|disable-library-validation/u)
  assert.match(adapterBuilder, /nativeManifest\.binary\.sha256/u)
  assert.match(adapterBuilder, /process\.platform === 'darwin'/u)
  assert.match(adapterBuilder, /\['lib', 'assets', 'docs'\]/u)
  assert.doesNotMatch(adapterBuilder, /process\.platform === 'win32'/u)
  assert.doesNotMatch(adapterBuilder, /unsupported computer-use build platform/u)
  assert.doesNotMatch(adapterBuilder, /--entitlements|allow-jit|allow-unsigned-executable-memory|disable-library-validation/u)
  assert.match(client, /@e-mate\/dsh-plugin-computer-use/u)
  assert.doesNotMatch(client, /@anionex\/dsh-computer-use/u)
  assert.doesNotMatch(adapterBuilder, /standingFullAccess|emate-permission|sandboxPolicy/u)
  assert.equal(leases, upstreamLeases)
  assert.doesNotMatch(leases, /standingFullAccess|emate-permission|sandboxPolicy/u)
  assert.equal((leases.match(/configuredAccess\(this\.config\(\), app\.bundleId, scope\)/gu) ?? []).length, 2)
  assert.match(leases, /approvalPolicy\(this\.ctx, agent\) === 'never'/u)
  assert.match(leases, /approval prompts are disabled/u)
  assert.doesNotMatch(bundle, /standingFullAccess|emate-permission/u)
  assert.doesNotMatch(bundle, /^import .* from ["']zod["'];?$/mu)
  assert.match(bundle, /current user request must explicitly select @电脑操控/u)
  assert.match(bundle, /Use CDP browser tools first for webpage tasks/u)
  assert.match(bundle, /new URL\("\.\.\/native\/macos\/", import\.meta\.url\)/u)
  assert.match(bundle, /new URL\("\.\.\/scripts\/build-native\.mjs", import\.meta\.url\)/u)
})

test('Computer Use is authorized only by the latest direct user request', () => {
  const message = text => ({
    type: 'user/message',
    data: { source: { kind: 'user' }, content: [{ type: 'text', text }] },
  })
  assert.equal(hasExplicitComputerUseRequest({ events: [] }), false)
  assert.equal(hasExplicitComputerUseRequest({ events: [message('普通请求')] }), false)
  assert.equal(hasExplicitComputerUseRequest({ events: [message('@电脑操控 读取当前应用')] }), true)
  assert.equal(hasExplicitComputerUseRequest({ events: [message('请解释文本 @电脑操控 的含义')] }), false)
  assert.equal(hasExplicitComputerUseRequest({
    events: [message('<computer-use explicit="true">用户已显式指定使用电脑操控完成本次请求。</computer-use>')],
  }), true)
  assert.equal(hasExplicitComputerUseRequest({
    events: [
      message('<computer-use explicit="true">用户已显式指定使用电脑操控完成本次请求。</computer-use>'),
      message('下一轮普通请求'),
    ],
  }), false)
})
