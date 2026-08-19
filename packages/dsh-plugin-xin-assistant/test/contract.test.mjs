import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { delimiter, join } from 'node:path'
import test from 'node:test'
import { buildCliArgs, EMATE_MANAGED_PYTHON_PATH, resolvePythonCommand } from '../lib/args.mjs'

const pythonEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }

test('bundled production CLI is exact, runnable, and only structured read operations are exposed', () => {
  const cli = new URL('../runtime/xin_agent_cli.py', import.meta.url)
  assert.equal(createHash('sha256').update(readFileSync(cli)).digest('hex'), '936c5a16ada2d59144b39848535f4ab36d0fb87b07665955513d20abc0606767')
  const schema = spawnSync('python3', [cli.pathname, 'schema'], { encoding: 'utf8', env: pythonEnv })
  assert.equal(schema.status, 0, schema.stderr)
  assert.equal(JSON.parse(schema.stdout).data.read_only, true)
  assert.deepEqual(buildCliArgs({ operation: 'realtime_summary', account_id: '42' }), ['realtime', 'summary', '--account-id', '42', '--xhs-channel', 'all'])
  assert.deepEqual(buildCliArgs({ operation: 'sync_changes', since: '2026-08-18 00:00:00' }), ['sync', 'changes', '--since', '2026-08-18 00:00:00'])
  assert.throws(() => buildCliArgs({ operation: 'auth_refresh' }), /白名单/u)
  assert.throws(() => buildCliArgs({ operation: 'account_list', search: 'x\n--force' }), /参数无效/u)
  const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.match(source, /ctx\.subprocess\.spawn/u)
  assert.match(source, /launchEnvironmentOf\(ctx\)/u)
  assert.match(source, /PYTHONPATH: `\$\{vendorRoot\}\$\{delimiter\}\$\{nativeVendorRoot\}`/u)
  assert.doesNotMatch(source, /node:child_process|\bexec(?:File)?\s*\(/u)
})

test('uses explicit config first and otherwise the Desktop-managed DSH launch environment', () => {
  const environment = {
    getFrom(name, sources) {
      assert.equal(name, EMATE_MANAGED_PYTHON_PATH)
      assert.deepEqual(sources, ['process'])
      return { value: '/Applications/e-Mate.app/Contents/Resources/python-runtime/python3' }
    },
  }
  assert.equal(resolvePythonCommand('/operator/python', environment, 'darwin'), '/operator/python')
  assert.equal(resolvePythonCommand('', environment, 'darwin'), '/Applications/e-Mate.app/Contents/Resources/python-runtime/python3')
  assert.equal(resolvePythonCommand('', { getFrom: () => undefined }, 'win32'), 'python')
  assert.equal(resolvePythonCommand('', { getFrom: () => undefined }, 'darwin'), 'python3')
})

test('bundled HTTP and RSA dependencies load from the target-specific plugin runtime', () => {
  const target = `${process.platform}-${process.arch}`
  if (!['darwin-arm64', 'darwin-x64', 'win32-x64'].includes(target)) return
  const root = new URL('../../..', import.meta.url).pathname
  const packagedPython = process.platform === 'win32'
    ? join(root, 'desktop/e-mate-desktop/build/python-runtime', target, 'python/python.exe')
    : join(root, 'desktop/e-mate-desktop/build/python-runtime', target, 'python/bin/python3')
  const python = existsSync(packagedPython) ? packagedPython : (process.platform === 'win32' ? 'python' : 'python3')
  const common = new URL('../runtime/vendor', import.meta.url).pathname
  const native = new URL(`../runtime/vendor-native/${target}`, import.meta.url).pathname
  const probe = spawnSync(python, ['-c', [
    'import requests, cryptography, _cffi_backend',
    'from cryptography.hazmat.primitives import hashes, serialization',
    'from cryptography.hazmat.primitives.asymmetric import padding',
    'print(requests.__version__, cryptography.__version__)',
  ].join(';')], {
    encoding: 'utf8',
    env: { ...pythonEnv, PYTHONPATH: `${common}${delimiter}${native}` },
  })
  assert.equal(probe.status, 0, probe.stderr)
  assert.equal(probe.stdout.trim(), '2.32.5 46.0.7')
})

test('macOS native extensions carry the declared ad-hoc signing identity', () => {
  if (process.platform !== 'darwin') return
  for (const target of ['darwin-arm64', 'darwin-x64']) {
    for (const relative of [
      '_cffi_backend.cpython-312-darwin.so',
      'cryptography/hazmat/bindings/_rust.abi3.so',
    ]) {
      const binary = new URL(`../runtime/vendor-native/${target}/${relative}`, import.meta.url).pathname
      const verified = spawnSync('/usr/bin/codesign', ['--verify', '--strict', binary], { encoding: 'utf8' })
      assert.equal(verified.status, 0, verified.stderr)
      const signature = spawnSync('/usr/bin/codesign', ['-dvv', binary], { encoding: 'utf8' })
      assert.match(`${signature.stdout}\n${signature.stderr}`, /Signature=adhoc/u)
    }
  }
})
