import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createNativeImageTaskRuntime } from '../src/profile/native-image-task-runner.ts'

const image = ordinal => ({ attachmentId: 'sha256:' + String(ordinal).padStart(64, '0'), mediaType: 'image/png', bytes: 8, width: 1, height: 1, name: 'image-' + ordinal + '.png' })

function session(id, meta = {}) {
  const events = []
  return { header: { id, ...meta }, events, append(type, data, options) { events.push({ seq: events.length, time: Date.now(), type, data, options }) } }
}

function harness({ flush = async () => true, mutateRun, outcome = 'completed', callCount = 1, parentSessionId = 'parent', onStart, onDispose, descriptorTransform, claimArgs, deadlineMs = 2_000 } = {}) {
  const disposers = []
  const parentSession = session(parentSessionId)
  const parent = { id: parentSessionId, session: parentSession }
  let runtime
  let live = 0
  let maximum = 0
  let providers = 0
  let childOrdinal = 0
  const scopes = []
  const starts = []
  const disposedOrder = []
  const aborted = []
  const returnedStarts = new Set()
  const claimsBeforeReturn = []
  const jobs = new Map()
  const ctx = {
    effect(setup) { const dispose = setup(); if (typeof dispose === 'function') disposers.push(dispose); return dispose },
    sessions: { flush },
    emateModelPolicy: { assertModel: async model => assert.equal(model, 'gpt-image-2-pro') },
    jobs: { get(id, owner) { const job = jobs.get(id); assert.equal(job.ownerSession, owner.id); return job } },
    subagents: {
      getProvider: () => ({ inheritsParentContext: false, capabilities: { toolFilter: true, persona: true } }),
      async start(name, request) {
        assert.equal(name, 'spawn')
        assert.deepEqual(request.toolFilter, { allow: ['imagegen'] })
        assert(!request.prompt[0].text.includes(request.label.slice('emate-image-batch:'.length)))
        const ordinal = ++childOrdinal
        const childSession = session('child-' + ordinal, { origin: 'subagent', parentSession: parentSessionId })
        starts.push(ordinal)
        if (onStart !== undefined) onStart({ ordinal, request, childSession })
        request.signal.addEventListener('abort', () => aborted.push(ordinal), { once: true })
        const descriptor = { version: 2, mode: 'one-shot', provider: 'spawn', label: request.label }
        childSession.append('subagent/descriptor', descriptorTransform === undefined ? descriptor : descriptorTransform(descriptor))
        const callId = 'call-' + ordinal
        for (let index = 0; index < callCount; index += 1) childSession.append('tool/call', { name: 'imagegen', callId: index === 0 ? callId : callId + '-' + index })
        live += 1; maximum = Math.max(maximum, live)
        let disposed = false
        const args = JSON.parse(request.prompt[0].text.split('\n')[2])
        const child = { id: 'child-' + ordinal, session: childSession }
        const result = (async () => {
          if (callCount === 0) return { stopReason: 'completed', output: [] }
          const scope = await runtime.claim(child, claimArgs === undefined ? args : claimArgs(args, ordinal))
          scopes.push(scope)
          assert.match(scope.batchId, /^sha256:[0-9a-f]{64}$/)
          assert.equal(scope.ordinal, ordinal)
          assert.match(scope.taskId, /^sha256:[0-9a-f]{64}$/)
          const selected = typeof outcome === 'function' ? outcome(ordinal) : outcome
          if (selected === 'wait-abort') {
            await new Promise(resolve => request.signal.addEventListener('abort', resolve, { once: true }))
            return { stopReason: 'aborted', output: [] }
          }
          if (selected === 'crash') {
            providers += 1
            throw new Error('simulated child crash')
          }
          if (selected === 'no-receipt') return { stopReason: 'completed', output: [] }
          if (selected === 'pre-job-failed') {
            childSession.append('emate/image-output', { schema_version: 2, revision: 2, call_id: callId,
              operation: 'generate', status: 'failed', billing_status: 'not-submitted', parent_session_id: child.id,
              client_request_id: 'image-' + scope.taskId.slice('sha256:'.length), sources: [], content: [], failure_code: 'validation-failed', verifier: {}, verification: {} })
            return { stopReason: 'error', output: [] }
          }
          providers += 1
          const jobId = 'emate-image-' + ordinal
          jobs.set(jobId, { kind: 'emate-image', ownerSession: child.id, status: 'completed' })
          const output = selected === 'invalid-image' ? { ...image(ordinal), extra: true }
            : selected === 'invalid-hash' ? { ...image(ordinal), attachmentId: 'sha256:no' }
              : selected === 'invalid-bytes' ? { ...image(ordinal), bytes: 0 }
                : selected === 'invalid-dimension' ? { ...image(ordinal), width: 65_536 }
                  : selected === 'invalid-name' ? { ...image(ordinal), name: 'bad/name.png' } : image(ordinal)
          childSession.append('emate/image-output', { schema_version: 2,
            revision: selected === 'invalid-revision' ? 4 : 2, call_id: callId,
            operation: selected === 'invalid-operation' ? 'edit' : 'generate',
            status: selected === 'bad-status' ? { value: 'completed' } : 'completed',
            billing_status: 'recorded', parent_session_id: child.id,
            client_request_id: 'image-' + scope.taskId.slice('sha256:'.length), sources: selected === 'invalid-sources' ? [image(99)] : [],
            content: [{ type: 'image', attachment: output }], job_id: jobId,
            output, verifier: {}, verification: {} })
          return { stopReason: 'completed', output: [] }
        })()
        const run = { id: child.id, localAgent: child, result,
          async dispose() { if (!disposed) { disposed = true; await result.catch(() => undefined); try { if (onDispose !== undefined) await onDispose(ordinal) } finally { disposedOrder.push(ordinal); live -= 1 } } } }
        returnedStarts.add(ordinal)
        return mutateRun ? mutateRun(run, ordinal) : run
      },
    },
  }
  runtime = createNativeImageTaskRuntime(ctx, { deadlineMs })
  const claim = runtime.claim
  runtime.claim = (agent, args) => { claimsBeforeReturn.push(!returnedStarts.has(Number(agent.id.slice('child-'.length)))); return claim(agent, args) }
  return { ctx, runtime, parent, parentSession, stats: () => ({ live, maximum, providers, scopes, starts, disposedOrder, aborted, claimsBeforeReturn }), dispose: async () => Promise.all(disposers.map(fn => fn())) }
}

for (const count of [2, 4, 5, 8]) test('runs ' + count + ' tasks with the requested worker bound', async () => {
  const h = harness()
  const concurrency = count === 2 ? 1 : 4
  const result = await h.runtime.execute({ tasks: Array.from({ length: count }, (_, index) => ({ prompt: 'image ' + index })), concurrency },
    { agent: h.parent, callId: 'batch-' + count, signal: new AbortController().signal })
  assert.equal(result.status, 'completed')
  assert.equal(result.images.length, count)
  assert.equal(result.failures.length, 0)
  assert.equal(h.stats().providers, count)
  assert(h.stats().maximum <= concurrency)
  assert.equal(h.stats().live, 0)
  assert.deepEqual(h.parentSession.events.map(event => event.data.kind).filter(Boolean).at(-1), 'terminal')
  const parentLog = JSON.stringify(h.parentSession.events)
  assert.equal(parentLog.includes('image 0'), false)
  assert.equal(parentLog.includes('attachmentId'), false)
  assert.equal(parentLog.includes('mediaType'), false)
  await h.dispose()
})

test('ordinary direct Agent claim returns without reading long session events', async () => {
  const h = harness()
  let eventReads = 0
  const longHistory = Array.from({ length: 100_000 }, (_, seq) => ({ seq, type: 'user/message', data: { seq } }))
  const appended = []
  const directSession = {
    header: { id: 'direct-parent' },
    get events() { eventReads += 1; return longHistory },
    append(type, data) { appended.push({ type, data }) },
  }
  const direct = { id: 'direct-parent', session: directSession }
  assert.equal(await h.runtime.claim(direct, { prompt: 'one direct image' }), undefined)
  assert.equal(eventReads, 0)
  assert.equal(h.stats().starts.length, 0)
  assert.equal(appended.filter(event => event.type === 'emate/image-batch').length, 0)
  assert.equal(h.parentSession.events.filter(event => event.type === 'emate/image-batch').length, 0)
})

test('provider remains closed until the parent child link is durable', async () => {
  let release
  let entered
  const blocked = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  let parentSession
  const h = harness({ flush: async current => {
    if (current === parentSession && current.events.at(-1)?.data?.kind === 'task-linked') {
      entered()
      await gate
    }
    return true
  } })
  parentSession = h.parentSession
  const execution = h.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }], concurrency: 1 },
    { agent: h.parent, callId: 'ordering', signal: new AbortController().signal })
  await blocked
  assert.equal(h.stats().providers, 0)
  assert.deepEqual(h.stats().claimsBeforeReturn, [true])
  release()
  const result = await execution
  assert.equal(result.images.length, 2)
  assert.equal(h.stats().providers, 2)
})

test('source tasks and failed created durability reject before child creation', async () => {
  const source = harness()
  await assert.rejects(source.runtime.execute({ tasks: [{ prompt: 'a', image_url: image(1).attachmentId }, { prompt: 'b' }] },
    { agent: source.parent, callId: 'source', signal: new AbortController().signal }), /source tasks are unavailable/)
  assert.equal(source.parentSession.events.length, 0)
  assert.equal(source.stats().providers, 0)

  const failed = harness({ flush: async () => false })
  await assert.rejects(failed.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }] },
    { agent: failed.parent, callId: 'flush', signal: new AbortController().signal }), /did not reach durable storage/)
  assert.equal(failed.stats().providers, 0)
  assert.deepEqual(failed.parentSession.events.map(event => event.data.kind), ['created'])
})

test('remote or mismatched local runs never open the provider gate', async () => {
  const h = harness({ mutateRun: run => ({ ...run, localAgent: undefined }) })
  const result = await h.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }], concurrency: 1 },
    { agent: h.parent, callId: 'remote', signal: new AbortController().signal })
  assert.equal(result.status, 'failed')
  assert.equal(result.images.length, 0)
  assert.equal(h.stats().providers, 0)
})

test('created, link, child, task, and terminal flush false or rejection fail closed', async t => {
  for (const phase of ['created', 'link', 'child', 'task', 'terminal']) {
    for (const mode of ['false', 'reject']) await t.test(phase + ' ' + mode, async () => {
      let parentSession
      let tripped = false
      const h = harness({ flush: async current => {
        const kind = current.events.at(-1)?.data?.kind
        const currentPhase = current !== parentSession ? 'child'
          : kind === 'created' ? 'created' : kind === 'task-linked' ? 'link'
            : kind === 'task-state' ? 'task' : kind === 'terminal' ? 'terminal' : 'other'
        if (!tripped && currentPhase === phase) {
          tripped = true
          if (mode === 'reject') throw new Error('simulated ' + phase + ' persistence rejection')
          return false
        }
        return true
      } })
      parentSession = h.parentSession
      await assert.rejects(h.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }], concurrency: 1 },
        { agent: h.parent, callId: 'flush-' + phase + '-' + mode, signal: new AbortController().signal }), /flush/)
      assert.equal(tripped, true)
      if (phase === 'created') assert.equal(h.stats().starts.length, 0)
      if (phase === 'link') assert.equal(h.stats().providers, 0)
      assert.equal(h.stats().live, 0)
    })
  }
})

test('deterministic replay guard refuses an existing batch before another start', async () => {
  const h = harness()
  const exec = { agent: h.parent, callId: 'replay', signal: new AbortController().signal }
  await h.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }] }, exec)
  const before = h.stats().starts.length
  await assert.rejects(h.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }] }, exec), /automatic replay is disabled/)
  assert.equal(h.stats().starts.length, before)
  assert.equal(h.stats().providers, 2)
})

test('each task receives a distinct deterministic gateway identity', async () => {
  const h = harness()
  await h.runtime.execute({ tasks: [{ prompt: 'same' }, { prompt: 'same' }, { prompt: 'same' }], concurrency: 3 },
    { agent: h.parent, callId: 'scope', signal: new AbortController().signal })
  assert.equal(h.stats().scopes.length, 3)
  assert.equal(new Set(h.stats().scopes.map(scope => scope.taskId)).size, 3)
  assert.equal(new Set(h.stats().scopes.map(scope => scope.batchId)).size, 1)
  assert.deepEqual(h.stats().scopes.map(scope => scope.ordinal), [1, 2, 3])
})

test('opened linked crashes and missing receipts become unknown, while pre-open failures remain not-submitted', async t => {
  for (const outcome of ['crash', 'no-receipt']) await t.test(outcome, async () => {
    const h = harness({ outcome })
    const result = await h.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }], concurrency: 1 },
      { agent: h.parent, callId: 'ambiguous-' + outcome, signal: new AbortController().signal })
    assert(result.tasks.every(task => task.state === 'unknown' && task.submission_status === 'unknown'
      && task.failure_code === 'provider-outcome-unknown' && task.child_session_id !== undefined))
  })
  const preOpen = harness({ claimArgs: args => ({ ...args, prompt: 'wrong' }) })
  const result = await preOpen.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }], concurrency: 1 },
    { agent: preOpen.parent, callId: 'pre-open', signal: new AbortController().signal })
  assert(result.tasks.every(task => task.state === 'failed' && task.submission_status === 'not-submitted'
    && task.child_session_id === undefined))
})

test('parent Agent identity must exactly own the parent Session before created', async () => {
  const h = harness()
  h.parent.id = 'other-agent'
  await assert.rejects(h.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }] },
    { agent: h.parent, callId: 'parent-mismatch', signal: new AbortController().signal }), /does not own its Session/)
  assert.equal(h.parentSession.events.length, 0)
  assert.equal(h.stats().starts.length, 0)
})

test('child receipt status and attachment references require canonical primitive data', async t => {
  for (const outcome of ['bad-status', 'invalid-image', 'invalid-operation', 'invalid-sources',
    'invalid-hash', 'invalid-bytes', 'invalid-dimension', 'invalid-name', 'invalid-revision']) await t.test(outcome, async () => {
    const h = harness({ outcome })
    const result = await h.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }], concurrency: 1 },
      { agent: h.parent, callId: 'strict-' + outcome, signal: new AbortController().signal })
    assert.equal(result.status, 'failed')
    assert.equal(result.images.length, 0)
    assert.equal(result.failures.length, 2)
  })
})

test('pre-Job validation receipt is retained without inventing a Job', async () => {
  const h = harness({ outcome: 'pre-job-failed' })
  const result = await h.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }] },
    { agent: h.parent, callId: 'pre-job', signal: new AbortController().signal })
  assert.equal(result.status, 'failed')
  assert.equal(result.failures.length, 2)
  assert(result.failures.every(failure => failure.receipt?.status === 'failed' && failure.job_id === undefined))
  assert.equal(h.stats().providers, 0)
})

test('partial result retains successful image and child pointer beside failure', async () => {
  const h = harness({ outcome: ordinal => ordinal === 2 ? 'pre-job-failed' : 'completed' })
  const result = await h.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }], concurrency: 2 },
    { agent: h.parent, callId: 'partial', signal: new AbortController().signal })
  assert.equal(result.status, 'partial')
  assert.equal(result.images.length, 1)
  assert.equal(result.failures.length, 1)
  assert.equal(result.images[0].ordinal, 1)
  assert.equal(result.failures[0].ordinal, 2)
})

test('wrong, zero, multiple, sibling, continuable, and remote children cannot authorize another provider call', async t => {
  const cases = [
    ['wrong args', { claimArgs: args => ({ ...args, prompt: 'wrong' }) }],
    ['zero calls', { callCount: 0 }],
    ['multiple calls', { callCount: 2 }],
    ['sibling parent', { onStart: ({ childSession }) => { childSession.header.parentSession = 'sibling' } }],
    ['continuable descriptor', { descriptorTransform: value => ({ ...value, mode: 'continuable' }) }],
    ['remote run', { mutateRun: run => ({ ...run, localAgent: undefined }) }],
  ]
  for (const [name, options] of cases) await t.test(name, async () => {
    const h = harness(options)
    const result = await h.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }], concurrency: 1 },
      { agent: h.parent, callId: 'guard-' + name, signal: new AbortController().signal })
    if (name === 'multiple calls') {
      assert.equal(result.status, 'partial')
      assert.equal(result.images.length, 2)
      assert.equal(result.failures.length, 2)
      assert.equal(h.stats().providers, 2)
    } else {
      assert.equal(result.images.length, 0)
      assert.equal(h.stats().providers, 0)
    }
  })
})

test('cancellation, timeout, and HMR abort claimed gates and dispose every run', async t => {
  await t.test('cancel', async () => {
    const controller = new AbortController()
    const h = harness({ outcome: 'wait-abort' })
    const execution = h.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }], concurrency: 2 },
      { agent: h.parent, callId: 'cancel', signal: controller.signal })
    await new Promise(resolve => setImmediate(resolve))
    controller.abort(new Error('cancel test'))
    const result = await execution
    assert.equal(result.status, 'cancelled')
    assert(result.tasks.every(task => task.state === 'cancelled' && task.submission_status === 'unknown'))
    assert.deepEqual(h.stats().aborted.sort(), [1, 2])
    assert.equal(h.stats().live, 0)
  })
  await t.test('timeout', async () => {
    const h = harness({ outcome: 'wait-abort', deadlineMs: 10 })
    const result = await h.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }], concurrency: 1 },
      { agent: h.parent, callId: 'timeout', signal: new AbortController().signal })
    assert.equal(result.status, 'failed')
    assert(result.tasks.every(task => task.state === 'unknown' && task.submission_status === 'unknown'))
    assert.equal(h.stats().live, 0)
    assert(h.stats().aborted.length >= 1)
  })
  await t.test('HMR dispose', async () => {
    const h = harness({ outcome: 'wait-abort' })
    const execution = h.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }], concurrency: 2 },
      { agent: h.parent, callId: 'hmr', signal: new AbortController().signal })
    await new Promise(resolve => setImmediate(resolve))
    await h.dispose()
    await execution
    assert.equal(h.stats().live, 0)
    assert.deepEqual(h.stats().aborted.sort(), [1, 2])
  })
})

test('worker refills only after prior native run disposal completes', async () => {
  let entered
  let release
  const blocked = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const h = harness({ onDispose: async ordinal => { if (ordinal === 1) { entered(); await gate } } })
  const execution = h.runtime.execute({ tasks: [{ prompt: 'a' }, { prompt: 'b' }], concurrency: 1 },
    { agent: h.parent, callId: 'dispose-refill', signal: new AbortController().signal })
  await blocked
  assert.deepEqual(h.stats().starts, [1])
  release()
  await execution
  assert.deepEqual(h.stats().starts, [1, 2])
  assert.deepEqual(h.stats().disposedOrder, [1, 2])
})

test('fatal task persistence aborts siblings immediately and stops queued admission', async () => {
  let parentSession
  let tripped = false
  const h = harness({
    outcome: ordinal => ordinal === 1 ? 'completed' : 'wait-abort',
    flush: async current => {
      if (!tripped && current === parentSession && current.events.at(-1)?.data?.kind === 'task-state') {
        tripped = true
        return false
      }
      return true
    },
  })
  parentSession = h.parentSession
  await assert.rejects(h.runtime.execute({ tasks: Array.from({ length: 5 }, (_, index) => ({ prompt: 'task ' + index })), concurrency: 2 },
    { agent: h.parent, callId: 'fatal-abort', signal: new AbortController().signal }), /flush/)
  assert.equal(tripped, true)
  assert(h.stats().aborted.includes(2))
  assert(h.stats().starts.length <= 2)
  assert.equal(h.stats().live, 0)
})

test('cleanup fatal aborts siblings immediately and prevents refill', async () => {
  const h = harness({
    outcome: ordinal => ordinal === 1 ? 'completed' : 'wait-abort',
    onDispose: async ordinal => { if (ordinal === 1) throw new Error('simulated cleanup failure') },
  })
  await assert.rejects(h.runtime.execute({ tasks: Array.from({ length: 5 }, (_, index) => ({ prompt: 'cleanup ' + index })), concurrency: 2 },
    { agent: h.parent, callId: 'cleanup-fatal', signal: new AbortController().signal }), /cleanup failure/)
  assert(h.stats().aborted.includes(2))
  assert(h.stats().starts.length <= 2)
  assert.equal(h.stats().live, 0)
})

test('public activation has one registration, Tool Search aliases, audit trust, and sessions injection', () => {
  const generation = readFileSync(new URL('../src/profile/image-generation.ts', import.meta.url), 'utf8')
  const audit = readFileSync(new URL('../src/profile/audit.ts', import.meta.url), 'utf8')
  const profile = readFileSync(new URL('../profile/cordis.patch.yml', import.meta.url), 'utf8')
  const search = readFileSync(new URL('../../dsh-plugin-tool-search/cordis.patch.yml', import.meta.url), 'utf8')
  assert.equal((generation.match(/name: 'image_batch'/g) ?? []).length, 1)
  assert.match(generation, /imageBatchProjectionDefinition\(z\)/)
  const batchRegistration = generation.slice(generation.indexOf("name: 'image_batch'"), generation.indexOf("name: 'image_pack'"))
  assert.doesNotMatch(batchRegistration, /presentationMeta|\$eMateDeliverables|attachment_id/)
  assert.match(batchRegistration, /IMAGE_BATCH_TIMEOUT_MS/)
  assert.match(audit, /\['image_batch',[\s\S]*scenario: 'ASSET_PRODUCTION'/u)
  assert.match(profile, /sessionPersistence, sessions, agents, subagents/u)
  assert.match(search, /^\s+- image_batch$/mu)
  assert.match(search, /image_batch:[\s\S]*批量生图[\s\S]*生成多张图片/u)
})
