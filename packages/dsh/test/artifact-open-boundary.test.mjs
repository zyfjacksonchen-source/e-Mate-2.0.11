import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply } from '../profile/plugins/artifact-open-boundary.js'

test('artifact opener canonicalizes local workspace files and refuses every other host path', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'e-mate-artifact-open-')))
  const outsideRoot = realpathSync(mkdtempSync(join(tmpdir(), 'e-mate-artifact-outside-')))
  const outside = join(outsideRoot, 'outside.txt')
  const report = join(root, 'report.txt')
  const escapedRoot = join(root, 'escaped')
  const escaped = join(escapedRoot, 'outside.txt')
  writeFileSync(report, 'report')
  writeFileSync(outside, 'outside')
  symlinkSync(outsideRoot, escapedRoot, process.platform === 'win32' ? 'junction' : 'dir')

  const opened = []
  const original = async request => {
    opened.push(request.payload.path)
    return { rpcId: request.rpcId, result: { ok: true, value: { opened: true } } }
  }
  let dispose
  const ctx = {
    apiProxy: { host: { openPath: original } },
    workspaceRegistry: { list: () => [{ path: root }] },
    effect: effect => { dispose = effect() },
  }
  apply(ctx)
  const signal = new AbortController().signal
  const request = path => ({ rpcId: 'open-1', payload: { path } })

  assert.deepEqual(await ctx.apiProxy.host.openPath(request(report), signal), {
    rpcId: 'open-1', result: { ok: true, value: { opened: true } },
  })
  assert.deepEqual(opened, [realpathSync(report)])
  for (const unsafe of ['report.txt', outside, escaped]) {
    const response = await ctx.apiProxy.host.openPath(request(unsafe), signal)
    assert.equal(response.result.ok, false)
    assert.match(response.result.error.message, /inside a registered workspace/u)
  }
  const aborted = new AbortController()
  aborted.abort()
  assert.equal((await ctx.apiProxy.host.openPath(request(report), aborted.signal)).result.error.code, 'cancelled')
  assert.deepEqual(opened, [realpathSync(report)])
  dispose()
  assert.equal(ctx.apiProxy.host.openPath, original)
})
