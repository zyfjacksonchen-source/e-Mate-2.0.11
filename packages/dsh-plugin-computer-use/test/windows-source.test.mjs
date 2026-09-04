import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import * as loaderYaml from '../../../upstream/deepseek-harness/vendor/include/node_modules/js-yaml/dist/js-yaml.mjs'
import { WindowsBackend, WindowsHelperClient, sanitizeWindowsObservation } from '../src/windows.ts'

const root = new URL('../', import.meta.url)
const target = { bundleId: 'c:\\apps\\editor.exe', pid: 42, name: 'editor', executablePath: 'C:\\Apps\\editor.exe', processStartTime: '638000000000000000', windowId: 1001 }
const frame = { x: 10, y: 20, width: 800, height: 600 }
const hash = 'a'.repeat(64)
const options = { screenshot: 'none', maxNodes: 500, maxDepth: 14, maxTextBytes: 64000 }
const rawObservation = { app: target, stateHash: hash, frontmost: true, window: { id: target.windowId, title: 'Document', frame }, treeText: '[0] Window Document', truncated: false, elements: [{ index: 0, locator: [], role: 'Window', actions: [], enabled: true, focused: true, frame }], permissions: { accessibility: 'granted', screenRecording: 'granted' } }
const hiddenConfig = { actionTimeoutMs: 15000, maxNodes: 500, maxDepth: 14, maxTextBytes: 64000, interaction: { focusPolicy: 'preserve', keyboardPolicy: 'preserve', pointerInputPolicy: 'targeted', cursorVisualization: 'hidden', cursorMotionMs: 0, cursorAutoHideMs: 0 } }

function reader(text, lossy = false) { return { readFrom: () => ({ text, lossy }) } }
function completedHandle(envelope = { ok: true, value: null }) {
  let waits = 0; let terminations = 0
  return { handle: { done: Promise.resolve({ exitCode: 0 }), collected: { stdout: reader(JSON.stringify(envelope)), stderr: reader('') }, terminate: () => { terminations += 1 }, waitForExit: async () => { waits += 1; return true } }, waits: () => waits, terminations: () => terminations }
}
async function fixtureRoot() { const path = await mkdtemp(join(tmpdir(), 'emate-win-helper-')); await cp(new URL('native/windows/', root), path, { recursive: true }); return path }
function backendWithReplies(replies, config = hiddenConfig) {
  const backend = new WindowsBackend({ subprocess: {} }, config, { platform: 'win32' }); const calls = []
  backend.client.invoke = async request => { calls.push(structuredClone(request)); const next = replies.shift(); if (next instanceof Error) throw next; return next }
  return { backend, calls }
}

test('public app, summary, and observation never enumerate private Windows target facts', async () => {
  const listRow = { ...target, frontmost: true, accessibility: 'granted', screenRecording: 'granted' }
  const { backend } = backendWithReplies([target, rawObservation, [listRow]])
  const app = await backend.resolveApp({ pid: 42 }, new AbortController().signal)
  assert.deepEqual(Object.keys(app), ['bundleId', 'pid', 'name'])
  assert.match(app.bundleId, /^win32:sha256:[a-f0-9]{64}$/u)
  for (const secret of [target.executablePath, target.processStartTime]) assert.equal(JSON.stringify(app).includes(secret), false)
  const observation = await backend.observe(app, options, new AbortController().signal)
  assert.strictEqual(observation.app, app)
  assert.deepEqual(Object.keys(observation.app), ['bundleId', 'pid', 'name'])
  assert.deepEqual(Object.keys(observation.window), ['title', 'frame'])
  assert.equal(JSON.stringify(observation).includes(target.executablePath), false)
  assert.equal(JSON.stringify(observation).includes(target.processStartTime), false)
  assert.equal(JSON.stringify(observation).includes('windowId'), false)
  const rows = await backend.listApps(new AbortController().signal)
  assert.deepEqual(Object.keys(rows[0]), ['bundleId', 'pid', 'name', 'frontmost', 'accessibility', 'screenRecording'])
  assert.deepEqual({ frontmost: rows[0].frontmost, accessibility: rows[0].accessibility, screenRecording: rows[0].screenRecording }, { frontmost: true, accessibility: 'granted', screenRecording: 'granted' })
  assert.equal(JSON.stringify(rows).includes(target.executablePath), false)
})

test('resolveApp accepts only exact opaque bundle ids and never sends an empty fallback selector', async () => {
  const listRow = { ...target, frontmost: true, accessibility: 'granted', screenRecording: 'granted' }
  const opaque = 'win32:sha256:' + createHash('sha256').update(target.executablePath.toLowerCase()).digest('hex')
  const { backend, calls } = backendWithReplies([[listRow]])
  const app = await backend.resolveApp({ bundleId: opaque, pid: 42, name: 'editor' }, new AbortController().signal)
  assert.equal(app.bundleId, opaque)
  assert.equal(calls[0].command, 'list-apps')
  for (const bundleId of [target.executablePath, 'win32:sha256:' + 'A'.repeat(64), 'win32:sha256:abc', 'other:' + 'a'.repeat(64)]) {
    const invalid = backendWithReplies([])
    await assert.rejects(invalid.backend.resolveApp({ bundleId }, new AbortController().signal), /opaque win32 SHA-256/u)
    assert.equal(invalid.calls.length, 0)
  }
  const empty = backendWithReplies([])
  await assert.rejects(empty.backend.resolveApp({}, new AbortController().signal), /requires bundleId, pid, or name/u)
  assert.equal(empty.calls.length, 0)
})

test('private mapping rejects cloned public identity before reobserve', async () => {
  const { backend, calls } = backendWithReplies([target])
  const app = await backend.resolveApp({ pid: 42 }, new AbortController().signal)
  await assert.rejects(backend.observe({ ...app }, options, new AbortController().signal), /cloned, expired/u)
  assert.equal(calls.length, 1)
})

test('observation sanitizer rejects replacement, extras, and hostile scalar coercion', () => {
  const app = { bundleId: 'win32:sha256:' + 'b'.repeat(64), pid: 42, name: 'editor' }
  assert.equal(sanitizeWindowsObservation(rawObservation, target, app, options).app, app)
  for (const changed of [
    { ...rawObservation, extra: true }, { ...rawObservation, app: { ...target, pid: 43 } },
    { ...rawObservation, window: { ...rawObservation.window, id: 1002 } }, { ...rawObservation, stateHash: 'not-a-hash' },
    { ...rawObservation, permissions: { ...rawObservation.permissions, accessibility: { toString() { throw new Error('coerced') } } } },
    { ...rawObservation, elements: [{ ...rawObservation.elements[0], extra: true }] },
  ]) assert.throws(() => sanitizeWindowsObservation(changed, target, app, options), /invalid/u)
  const screenshotOptions = { ...options, screenshot: 'required', screenshotPath: 'C:\\workspace\\observation.png' }
  assert.throws(() => sanitizeWindowsObservation(rawObservation, target, app, screenshotOptions), /omitted/u)
  assert.throws(() => sanitizeWindowsObservation({ ...rawObservation, screenshot: { path: 'C:\\other\\stolen.png', width: 800, height: 600 } }, target, app, screenshotOptions), /invalid screenshot/u)
})

test('action result requires exact keys and primitive enum strings', async () => {
  const action = { kind: 'press-key', key: 'A', modifiers: ['control'], observationId: 'o' }
  for (const bad of [
    { channel: { toString() { throw new Error('coerced') } }, activation: 'already-frontmost', pointerInput: false, pointerRouting: 'none', cleanupComplete: true, targetVerified: true, target: { ...target, preStateHash: hash } },
    { channel: 'keyboard', activation: 'already-frontmost', pointerInput: false, pointerRouting: 'none', cleanupComplete: true, targetVerified: true, target: { ...target, preStateHash: hash }, extra: true },
  ]) {
    const { backend } = backendWithReplies([target, bad, { cleanupComplete: true, target }]); const app = await backend.resolveApp({ pid: 42 }, new AbortController().signal)
    await assert.rejects(backend.act({ action, app, expectedStateHash: hash, interaction: hiddenConfig.interaction, window: { title: 'Document', frame } }, new AbortController().signal), /invalid action/u)
  }
})

test('failed action cleanup carries exact original action and private target', async () => {
  const action = { kind: 'press-key', key: 'A', modifiers: ['control'], observationId: 'o' }
  const { backend, calls } = backendWithReplies([target, new Error('partial input'), { cleanupComplete: true, target }])
  const app = await backend.resolveApp({ pid: 42 }, new AbortController().signal)
  await assert.rejects(backend.act({ action, app, expectedStateHash: hash, interaction: hiddenConfig.interaction, window: { title: 'Document', frame } }, new AbortController().signal), /partial input/u)
  assert.equal(calls[2].command, 'release-input'); assert.deepEqual(calls[2].action, action); assert.deepEqual(calls[2].app, target); assert.equal(calls[2].window.id, target.windowId)
})

test('helper uses validated SystemRoot, exact PowerShell path, bounds, and fresh integrity', async () => {
  const managedRoot = await fixtureRoot(); const calls = []; const checked = []
  const process = completedHandle({ ok: true, value: { helperVersion: '1.0.0', accessibility: 'granted', screenRecording: 'granted' } })
  const client = new WindowsHelperClient({ subprocess: { spawn(spec) { calls.push(spec); return process.handle } } }, 15000, managedRoot, 'win32', { environment: { SystemRoot: 'C:\\Windows', WINDIR: 'c:\\windows' }, validateExecutable: async path => { checked.push(path) } })
  try {
    await client.invoke({ command: 'health' }, new AbortController().signal)
    assert.equal(calls[0].argv[0], 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    assert.deepEqual(checked, [calls[0].argv[0]]); assert.equal(calls[0].stdio.stdout.maxBytes, 4 * 1024 * 1024); assert.equal(calls[0].stdio.stderr.maxBytes, 64 * 1024); assert.equal(process.waits(), 1)
    await writeFile(join(managedRoot, 'dsh-computer-use-helper.ps1'), '# tampered after first invocation\n')
    await assert.rejects(client.invoke({ command: 'health' }, new AbortController().signal), /hash does not match/u)
    assert.equal(calls.length, 1)
    await assert.rejects(client.invoke({ command: 'health', data: 'x'.repeat(256 * 1024) }, new AbortController().signal), /request exceeded/u)
  } finally { await rm(managedRoot, { recursive: true, force: true }) }
})

test('invalid environment and envelope extras fail before unsafe use', async () => {
  const managedRoot = await fixtureRoot()
  try {
    for (const environment of [{}, { SystemRoot: 'Windows' }, { SystemRoot: 'C:\\Windows\\..\\Temp' }, { SystemRoot: 'C:\\Windows\0bad' }, { SystemRoot: 'C:\\Windows', WINDIR: 'D:\\Windows' }]) {
      let spawned = false
      const client = new WindowsHelperClient({ subprocess: { spawn() { spawned = true } } }, 15000, managedRoot, 'win32', { environment, validateExecutable: async () => {} })
      await assert.rejects(client.invoke({ command: 'health' }, new AbortController().signal), /SystemRoot|WINDIR/u); assert.equal(spawned, false)
    }
    const process = completedHandle({ ok: true, value: null, extra: true })
    const client = new WindowsHelperClient({ subprocess: { spawn() { return process.handle } } }, 15000, managedRoot, 'win32', { environment: { SystemRoot: 'C:\\Windows' }, validateExecutable: async () => {} })
    await assert.rejects(client.invoke({ command: 'health' }, new AbortController().signal), /invalid envelope/u)
    const errorProcess = completedHandle({ ok: false, error: { code: 'COMPUTER_ACTION_BLOCKED', message: 'denied', extra: true } })
    const errorClient = new WindowsHelperClient({ subprocess: { spawn() { return errorProcess.handle } } }, 15000, managedRoot, 'win32', { environment: { SystemRoot: 'C:\\Windows' }, validateExecutable: async () => {} })
    await assert.rejects(errorClient.invoke({ command: 'health' }, new AbortController().signal), /invalid envelope/u)
  } finally { await rm(managedRoot, { recursive: true, force: true }) }
})

test('helper and stderr text never reaches caller-visible errors', async () => {
  const managedRoot = await fixtureRoot()
  try {
    const secret = 'C:\\Users\\Alice\\secret.txt\nWindow title\n at private stack'
    const process = completedHandle({ ok: false, error: { code: 'COMPUTER_ACTION_BLOCKED', message: secret } })
    const client = new WindowsHelperClient({ subprocess: { spawn() { return process.handle } } }, 15000, managedRoot, 'win32', { environment: { SystemRoot: 'C:\\Windows' }, validateExecutable: async () => {} })
    await assert.rejects(client.invoke({ command: 'health' }, new AbortController().signal), error => {
      assert.equal(error.code, 'COMPUTER_ACTION_BLOCKED')
      for (const leaked of ['C:\\Users', 'Alice', 'secret.txt', 'Window title', 'private stack']) assert.equal(error.message.includes(leaked), false)
      assert.equal(error.message, 'COMPUTER_ACTION_BLOCKED: Windows denied the requested UI action because required desktop or integrity authority is unavailable.')
      return true
    })
    const failed = { done: Promise.resolve({ exitCode: 2 }), collected: { stdout: reader(''), stderr: reader(secret) }, terminate() {}, async waitForExit() { return true } }
    const stderrClient = new WindowsHelperClient({ subprocess: { spawn() { return failed } } }, 15000, managedRoot, 'win32', { environment: { SystemRoot: 'C:\\Windows' }, validateExecutable: async () => {} })
    await assert.rejects(stderrClient.invoke({ command: 'health' }, new AbortController().signal), error => { assert.equal(error.message, 'COMPUTER_PROVIDER_FAILURE: Windows helper exited without a valid response'); assert.equal(error.message.includes('Alice'), false); return true })
  } finally { await rm(managedRoot, { recursive: true, force: true }) }
})

test('cancellation terminates and reaps the subprocess tree', async () => {
  const managedRoot = await fixtureRoot(); let terminate = 0; let wait = 0
  const handle = { done: new Promise(() => {}), collected: { stdout: reader(''), stderr: reader('') }, terminate: () => { terminate += 1 }, waitForExit: async () => { wait += 1; return true } }
  const client = new WindowsHelperClient({ subprocess: { spawn() { return handle } } }, 120000, managedRoot, 'win32', { environment: { SystemRoot: 'C:\\Windows' }, validateExecutable: async () => {} }); const controller = new AbortController()
  try { const pending = client.invoke({ command: 'health' }, controller.signal); setTimeout(() => controller.abort(), 10); await assert.rejects(pending, /COMPUTER_CANCELLED/u); assert.equal(terminate, 1); assert.equal(wait, 1) } finally { await rm(managedRoot, { recursive: true, force: true }) }
})

test('Windows cursor configuration is hidden and visible mode cannot silently no-op', async () => {
  const patch = await readFile(new URL('cordis.patch.yml', root), 'utf8'); assert.ok(patch.includes("process.platform === 'win32' ? 'hidden' : 'visible'"))
  const hidden = new WindowsBackend({ subprocess: {} }, hiddenConfig, { platform: 'win32' }); await hidden.visualizeCursor({}, 'before', new AbortController().signal)
  const visible = new WindowsBackend({ subprocess: {} }, { ...hiddenConfig, interaction: { ...hiddenConfig.interaction, cursorVisualization: 'visible' } }, { platform: 'win32' })
  await assert.rejects(visible.visualizeCursor({}, 'before', new AbortController().signal), /visualization is unavailable/u)
})

test('composition keeps one owner, bounded health probes, exact cleanup, and no candidate plugin layer', async () => {
  const [patch, source, helper, manifest, build, service, leases, confirmations] = await Promise.all([
    readFile(new URL('cordis.patch.yml', root), 'utf8'), readFile(new URL('src/windows.ts', root), 'utf8'), readFile(new URL('native/windows/dsh-computer-use-helper.ps1', root), 'utf8'), readFile(new URL('native/windows/manifest.json', root), 'utf8'), readFile(new URL('scripts/build.mjs', root), 'utf8'), readFile(new URL('../../upstream/plugins/dsh-computer-use/src/service.ts', root), 'utf8'), readFile(new URL('../../upstream/plugins/dsh-computer-use/src/leases.ts', root), 'utf8'), readFile(new URL('../../upstream/plugins/dsh-computer-use/src/confirmations.ts', root), 'utf8'),
  ])
  const jsExpr = new loaderYaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', resolve: data => typeof data === 'string', construct: data => ({ __jsExpr: data }) })
  const parsedPatch = loaderYaml.load(patch, { schema: loaderYaml.JSON_SCHEMA.extend(jsExpr) })
  const rows = parsedPatch.flatMap(operation => operation.insert ?? []).filter(row => row.id === 'emate-computer-use')
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].disabled, { __jsExpr: "Array.of('darwin', 'win32').includes(process.platform) === false" })
  assert.deepEqual(rows[0].config.interaction.cursorVisualization, { __jsExpr: "process.platform === 'win32' ? 'hidden' : 'visible'" })
  assert.equal(rows[0].config.interaction.focusPolicy, 'preserve')
  assert.equal(rows[0].config.interaction.keyboardPolicy, 'preserve')
  assert.match(helper, /if\(\$policy -ne 'activate'\)\{throw 'configured activation policy denies fallback while target is not foreground'\}; if\(-not \[EmateWin32\]::SetForegroundWindow/u)
  assert.match(helper, /elseif\(\$a\.kind -eq 'type-text'\)[\s\S]*?Ensure-Foreground \$hwnd \(\[string\]\$request\.interaction\.keyboardPolicy\)[\s\S]*?foreach\(\$ch[\s\S]*?Send-Checked/u)
  assert.match(helper, /elseif\(\$a\.kind -eq 'press-key'\)[\s\S]*?Ensure-Foreground \$hwnd \(\[string\]\$request\.interaction\.keyboardPolicy\)[\s\S]*?Send-Checked/u)
  const disabled = platform => Function('process', 'return (' + rows[0].disabled.__jsExpr + ')')({ platform })
  assert.equal(disabled('darwin'), false)
  assert.equal(disabled('win32'), false)
  assert.equal(disabled('linux'), true)
  assert.doesNotMatch(patch, /!!js\s+!/u)
  for (const excluded of ['node:child_process', 'spawnSync', 'src/ps.js', 'computer_set_mode']) assert.equal(source.includes(excluded), false)
  for (const excluded of ['computer_set_mode', 'output-guard', 'src\\index.js']) assert.equal(helper.includes(excluded), false)
  assert.ok(helper.includes('SPDX-License-Identifier: MIT'))
  const encoding = helper.indexOf('$utf8 = [System.Text.UTF8Encoding]::new($false)')
  const input = helper.indexOf('[Console]::InputEncoding = $utf8')
  const output = helper.indexOf('[Console]::OutputEncoding = $utf8')
  const pipeline = helper.indexOf('$OutputEncoding = $utf8')
  const read = helper.indexOf('[Console]::In.ReadToEnd()')
  assert.ok(encoding >= 0 && input > encoding && output > input && pipeline > output && read > pipeline)
  for (const fact of ['RootElement', 'Drawing.Bitmap(1,1)', 'Release-Input $request.app $request.window $request.action', '@([string]$action.key)', 'SendMessageTimeout', 'secure desktop', 'locked session', 'RDP', 'elevated', 'UIPI']) assert.ok(helper.includes(fact))
  assert.equal(build.includes('executablePath?: string'), false)
  assert.equal((build.match(/\$\{'\$\{process\.platform\}'\}/gu) ?? []).length, 2)
  assert.equal((build.match(/current platform is \$\{process\.platform\}\\`/gu) ?? []).length, 0)
  assert.ok(build.includes('try {'))
  assert.ok(build.includes('} finally {'))
  assert.ok(build.includes('rm(runtimeBundle'))
  assert.ok(build.includes('rm(runtimeSource'))
  assert.match(service, /const screenshotPath[\s\S]*allocateScreenshotPath\(context\.workspace/u)
  assert.ok(service.includes('latest = await this.backend.observe(stored.backend.app'))
  assert.ok(leases.includes("approvalPolicy(this.ctx, agent) === 'never'")); assert.ok(leases.includes('this.controlGrants.get(agent)?.get(app.bundleId) === turn')); assert.ok(confirmations.includes('agentRecords?.delete(token)'))
  assert.equal(createHash('sha256').update(helper).digest('hex'), JSON.parse(manifest).source.sha256)
})
