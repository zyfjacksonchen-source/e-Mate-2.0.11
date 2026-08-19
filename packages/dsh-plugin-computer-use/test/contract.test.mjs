import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../', import.meta.url)

test('computer-use adapter preserves the immutable universal helper and macOS-only bundle', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8')
  const manifest = JSON.parse(await readFile(new URL('native/macos/manifest.json', root), 'utf8'))
  const helper = await readFile(new URL('native/macos/bin/dsh-computer-use-helper', root))
  const nativeBuilder = await readFile(new URL('scripts/build-native.mjs', root), 'utf8')
  const adapterBuilder = await readFile(new URL('scripts/build.mjs', root), 'utf8')
  const client = await readFile(new URL('lib/client.js', root), 'utf8')
  const leases = await readFile(new URL('lib/leases.js', root), 'utf8')
  const bundle = await readFile(new URL('lib/index.js', root), 'utf8')
  assert.equal(pkg.version, '2.0.11')
  assert.equal(pkg.dsh.upstream.commit, '76bfe8607f61945c1cbb84e73976e601100c13a2')
  assert.equal(pkg.eMate.harnessVersion, '0.1.0-rc.7')
  assert.match(patch, /process\.platform !== 'darwin'/u)
  assert.doesNotMatch(patch, /allowAllApps:\s*true/u)
  assert.deepEqual(manifest.binary.architectures, ['arm64', 'x86_64'])
  assert.equal(createHash('sha256').update(helper).digest('hex'), manifest.binary.sha256)
  if (process.platform === 'darwin') {
    const verified = spawnSync('/usr/bin/codesign', ['--verify', '--strict', new URL('native/macos/bin/dsh-computer-use-helper', root).pathname], { encoding: 'utf8' })
    assert.equal(verified.status, 0, verified.stderr)
    const signature = spawnSync('/usr/bin/codesign', ['-dvv', new URL('native/macos/bin/dsh-computer-use-helper', root).pathname], { encoding: 'utf8' })
    assert.match(`${signature.stdout}\n${signature.stderr}`, /Signature=adhoc/u)
  }
  assert.doesNotMatch(nativeBuilder, /HELPER_ENTITLEMENTS|--entitlements|allow-jit|disable-library-validation/u)
  assert.match(adapterBuilder, /nativeManifest\.binary\.sha256/u)
  assert.match(adapterBuilder, /process\.platform === 'darwin'/u)
  assert.doesNotMatch(adapterBuilder, /--entitlements|allow-jit|allow-unsigned-executable-memory|disable-library-validation/u)
  assert.match(client, /@e-mate\/dsh-plugin-computer-use/u)
  assert.doesNotMatch(client, /@anionex\/dsh-computer-use/u)
  assert.match(leases, /import \{ standingFullAccess \} from "\.\/emate-permission\.js"/u)
  assert.equal((leases.match(/standingFullAccess\(this\.ctx, agent\)/gu) ?? []).length, 2)
  assert.match(bundle, /static inject = \[[\s\S]*?"skills",\s*"sandboxPolicy"/u)
  assert.doesNotMatch(bundle, /^import .* from ["']zod["'];?$/mu)
  assert.match(bundle, /new URL\("\.\.\/native\/macos\/", import\.meta\.url\)/u)
  assert.match(bundle, /new URL\("\.\.\/scripts\/build-native\.mjs", import\.meta\.url\)/u)
})

test('application access follows the current DSH session policy without widening narrower presets', async () => {
  const { standingFullAccess } = await import('../lib/emate-permission.js')
  let mode = 'danger-full-access'
  const ctx = {
    sandboxPolicy: { resolve: () => ({ mode, workspaceRoot: '/tmp' }) },
  }
  const agent = { session: { id: 'session-1', header: { createdAt: 1 }, events: [{ type: 'turn/start', data: { turn: 1 } }] } }

  assert.equal(standingFullAccess(ctx, agent), true)
  mode = 'workspace-write'
  assert.equal(standingFullAccess(ctx, agent), false)
  mode = 'read-only'
  assert.equal(standingFullAccess(ctx, agent), false)
})
