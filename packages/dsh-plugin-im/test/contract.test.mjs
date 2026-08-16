import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  apply,
  DSH_IM_ADAPTER_STATUS,
  DSH_IM_BLOCK_CODE,
  UPSTREAM_COMMIT,
} from '../lib/index.js'

const root = new URL('../', import.meta.url)

test('adapter registers one truthful external-connection capability and no runtime', async () => {
  let capability
  apply({
    emateCapabilities: { register(definition) { capability = definition; return () => {} } },
    effect(effect) { effect() },
  })

  assert.equal(capability.id, 'dsh-im')
  assert.equal(capability.icon_key, 'collaboration')
  assert.deepEqual(capability.actions, [])
  assert.deepEqual(await capability.status(), {
    state: 'blocked',
    detail: `运行适配尚未通过固定 rc.5 与真实授权验收（${DSH_IM_BLOCK_CODE}）。`,
    action_ids: [],
  })
  assert.equal(DSH_IM_ADAPTER_STATUS.runtimeInstalled, false)
  assert.equal(DSH_IM_ADAPTER_STATUS.transportsRegistered, 0)
  assert.equal(DSH_IM_ADAPTER_STATUS.toolsRegistered, 0)
  assert.equal(UPSTREAM_COMMIT, '2eea8a08bcd8ef91e8845de1f300b5715b746938')
  assert.equal(DSH_IM_ADAPTER_STATUS.excludedChannels.includes('qq'), true)
})

test('package records the exact source and cannot carry an upstream runtime dependency', async () => {
  const [manifestText, source, notice] = await Promise.all([
    readFile(new URL('package.json', root), 'utf8'),
    readFile(new URL('src/index.ts', root), 'utf8'),
    readFile(new URL('THIRD_PARTY_NOTICES.txt', root), 'utf8'),
  ])
  const manifest = JSON.parse(manifestText)
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.dsh.im.upstreamCommit, UPSTREAM_COMMIT)
  assert.equal(manifest.eMate.harnessVersion, '0.1.0-rc.5')
  assert.equal(manifest.dependencies, undefined)
  assert.equal(manifest.peerDependencies, undefined)
  assert.match(notice, /UNLICENSED/u)
  assert.doesNotMatch(manifestText, /"@xmanrui\/dsh-im"\s*:/u)
  assert.doesNotMatch(source, /(?:rpc\.handle|WebSocket|EventSource|fetch\s*\(|Router|SessionStore)/u)
})
