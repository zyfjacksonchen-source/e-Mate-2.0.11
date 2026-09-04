#!/usr/bin/env node
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

const here = new URL('.', import.meta.url)
const [
  baselineText, ordersText, executionText, ownersText, regressionText, adrText,
  batchSchemaText, batchResultSchemaText, latencyContractText, latencyManifestText, enterpriseRecoveryText, fileImportHostText,
] = await Promise.all([
  readFile(new URL('baseline-lock.json', here), 'utf8'),
  readFile(new URL('work-orders.json', here), 'utf8'),
  readFile(new URL('execution-plan.md', here), 'utf8'),
  readFile(new URL('owners.md', here), 'utf8'),
  readFile(new URL('regression-inventory.md', here), 'utf8'),
  readFile(new URL('adr/ADR-0217-image-batch.md', here), 'utf8'),
  readFile(new URL('contracts/image-batch.schema.json', here), 'utf8'),
  readFile(new URL('contracts/image-batch-result.schema.json', here), 'utf8'),
  readFile(new URL('contracts/single-image-latency.md', here), 'utf8'),
  readFile(new URL('evidence-manifests/single-image-latency.json', here), 'utf8'),
  readFile(new URL('contracts/enterprise-model-recovery.md', here), 'utf8'),
  readFile(new URL('../../packages/dsh-plugin-file-import/src/index.ts', here), 'utf8'),
])
const baseline = JSON.parse(baselineText)
const orders = JSON.parse(ordersText)
const batchSchema = JSON.parse(batchSchemaText)
const batchResultSchema = JSON.parse(batchResultSchemaText)
const latencyManifest = JSON.parse(latencyManifestText)
const active = baseline.active

assert.equal(active.emate_baseline_sha, 'f876f01d8280e4ab20fe83b88c36c7fe7a662135')
assert.equal(active.harness_commit, '4da69d7c3522ee51de12822c917c503a124f7a7d')
assert.equal(active.desktop_reference_repository, 'anywhere-labs/deepseek-harness-desktop')
assert.equal(active.desktop_reference_commit, '6074088f5b660206e404b3591fab51fb99c69add')
assert.equal(active.package_manager, 'pnpm@11.7.0')
assert.equal(active.harness_package, '@deepseek-ai/dsh@0.1.0-rc.7')
assert.equal(baseline.operating_model.wip_limit, 6)
assert.equal(orders.operating_model.wip_limit, 6)
const rejected = baseline.rejected_references.find(item => item.status === 'REJECTED')
assert(rejected?.repository && rejected?.commit)
for (const text of [JSON.stringify(active), JSON.stringify(orders.baseline), ordersText, executionText, ownersText]) {
  assert(!text.includes(rejected.repository), 'rejected repository escaped baseline-lock.rejected_references')
  assert(!text.includes(rejected.commit), 'rejected commit escaped baseline-lock.rejected_references')
}
assert(!/(?:main|master|latest|HEAD)/.test(JSON.stringify([active, orders.baseline])), 'active baseline contains floating ref')

const tickets = orders.tickets
const ids = tickets.map(ticket => ticket.id)
const expectedIds = ['EM217-000', 'EM217-001', 'EM217-002', 'EM217-003', 'EM217-004', 'EM217-101', 'EM217-102', 'EM217-103', 'EM217-104', 'EM217-105', 'EM217-106', 'EM217-107', 'EM217-108', 'EM217-109', 'EM217-201', 'EM217-202', 'EM217-203', 'EM217-204', 'EM217-205', 'EM217-206', 'EM217-301', 'EM217-302', 'EM217-303', 'EM217-304', 'EM217-305', 'EM217-306', 'EM217-307', 'EM217-401', 'EM217-402', 'EM217-403', 'EM217-404', 'EM217-405', 'EM217-406', 'EM217-407', 'EM217-408', 'EM217-501', 'EM217-502', 'EM217-503', 'EM217-504', 'EM217-505', 'EM217-506', 'EM217-507']
assert.equal(tickets.length, 42)
assert.equal(new Set(ids).size, 42)
assert.deepEqual([...ids].sort(), [...expectedIds].sort())
assert(!/\b41 (?:unique|work orders)\b/.test(ordersText + executionText), 'work-order prose must match the 42-ticket plan')
const map = new Map(tickets.map(ticket => [ticket.id, ticket]))
for (const ticket of tickets) {
  for (const field of ['owner', 'write_set', 'acceptance', 'tests', 'rollback']) {
    const value = ticket[field]
    const present = Array.isArray(value) ? value.length > 0 && value.every(Boolean) : typeof value === 'string' && value.trim()
    assert(present, ticket.id + ' missing ' + field)
  }
  for (const dependency of ticket.depends_on) assert(map.has(dependency), ticket.id + ' unknown dependency ' + dependency)
}
const visiting = new Set(), visited = new Set()
function visit(id) {
  assert(!visiting.has(id), 'dependency cycle at ' + id)
  if (visited.has(id)) return
  visiting.add(id)
  for (const dependency of map.get(id).depends_on) visit(dependency)
  visiting.delete(id); visited.add(id)
}
for (const id of ids) visit(id)

const t = id => map.get(id)
const text = id => JSON.stringify(t(id))
const fileImport = t('EM217-307')
assert.equal(fileImport.owner, 'UI/shared-file-import')
assert.deepEqual(fileImport.depends_on, ['EM217-004', 'EM217-404'])
assert.equal(fileImport.branch, 'feat/2.0.17/em217-307-universal-file-upload')
assert.equal(fileImport.worktree, '/Users/mac/e-mate/worktrees/em217-307')
assert.deepEqual(fileImport.write_set, [
  'docs/2.0.17/check-plan.mjs',
  'docs/2.0.17/execution-plan.md',
  'docs/2.0.17/owners.md',
  'docs/2.0.17/regression-inventory.md',
  'docs/2.0.17/work-orders.json',
  'tests/regression/2.0.17/inventory.json',
  'tests/regression/2.0.17/inventory.test.mjs',
  'packages/dsh-plugin-file-import/**',
])
assert(t('EM217-501').depends_on.includes('EM217-307'))
assert(fileImport.tests.includes('MAIN-AGENT-ONLY COMPONENT CHECK (requires installed pinned Harness workspace): workdir: upstream/deepseek-harness; node_modules/.bin/vitest run --config ../../packages/dsh/profile/plugins/emate-shell/vitest.config.ts ../../packages/dsh-plugin-file-import/test/client-flow.client.spec.tsx'))
assert(!text('EM217-307').includes('pnpm exec'), 'EM217-307 must call the already-installed pinned Harness vitest binary directly')
assert(executionText.includes('The main agent is sole integrator'))
for (const required of ['internal', 'bad-request', 'ALLOWED_MEDIA_BY_EXTENSION', 'NFC', '零字节', '16 MiB', '32 MiB', 'batch rollback', 'serverResponseSchema', 'invalid_union', 'native image']) {
  assert(text('EM217-307').toLowerCase().includes(required.toLowerCase()), 'EM217-307 missing ' + required)
}
assert(text('EM217-307').includes('不新增 Store、Router、transport、Host 路径或 spreadsheet-specific endpoint/protocol'), 'EM217-307 must forbid spreadsheet-specific paths and protocols')
assert(!/(?:xlsx|spreadsheet|表格)/iu.test(fileImportHostText), 'Host import path must not specialize spreadsheets')

for (const [name, schema] of [['image-batch', batchSchema], ['image-batch-result', batchResultSchema]]) {
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', name + ' must use JSON Schema 2020-12')
  assert(schema.$defs && typeof schema.$defs === 'object', name + ' must be self-contained')
  const pending = [schema]
  while (pending.length > 0) {
    const value = pending.pop()
    if (Array.isArray(value)) pending.push(...value)
    else if (value && typeof value === 'object') {
      if (typeof value.$ref === 'string') assert(value.$ref.startsWith('#/$defs/'), name + ' contains an external $ref')
      pending.push(...Object.values(value))
    }
  }
}
assert.equal(batchSchema.$defs.toolInput.additionalProperties, false)
assert.equal(batchSchema.$defs.toolInput.properties.tasks.minItems, 2)
assert.equal(batchSchema.$defs.toolInput.properties.tasks.maxItems, 8)
assert.equal(batchSchema.$defs.toolInput.properties.concurrency.default, 3)
assert.equal(batchSchema.$defs.toolInput.properties.concurrency.maximum, 4)
const rawImageUrlArray = batchSchema.$defs.imageUrl.oneOf.find(value => value.type === 'array')
assert.equal(rawImageUrlArray.minItems, 0)
assert.equal(rawImageUrlArray.maxItems, 16)
assert.equal(rawImageUrlArray.uniqueItems, undefined, 'raw image_url arrays must allow duplicates')
assert.equal(batchSchema.$defs.toolTask.additionalProperties, false)
assert.equal(batchSchema.$defs.taskSnapshot.properties.image_url.uniqueItems, true)
assert.equal(batchResultSchema.$defs.terminalTask.properties.image_url.uniqueItems, true)
assert.equal(batchSchema.$defs.taskSnapshot.additionalProperties, false)
assert.equal(batchSchema.$defs.receiptRef.additionalProperties, false)
assert.equal(batchSchema.$defs.receiptRef.properties.attachment, undefined, 'parent receiptRef must be pointer-only')
assert(batchSchema.$defs.createdEvent.allOf[1].required.includes('concurrency'))
assert.equal(batchSchema.$defs.createdEvent.allOf[1].properties.concurrency.minimum, 1)
assert.equal(batchSchema.$defs.createdEvent.allOf[1].properties.concurrency.maximum, 4)
assert.deepEqual(batchSchema.$defs.event.oneOf.map(value => value.$ref), [
  '#/$defs/createdEvent', '#/$defs/taskLinkedEvent', '#/$defs/taskStateEvent', '#/$defs/terminalEvent',
])
assert.equal(batchSchema.$defs.taskLinkedSnapshot.allOf[1].properties.state.const, 'queued')
assert.equal(batchSchema.$defs.taskLinkedSnapshot.allOf[1].properties.submission_status.const, 'not-submitted')
assert.equal(batchSchema.$defs.taskLinkedSnapshot.allOf[1].properties.revision.minimum, 2)
assert(batchSchema.$defs.taskLinkedSnapshot.allOf[1].required.includes('child_session_id'))
for (const forbidden of ['job_id', 'receipt', 'failure_code']) {
  assert(batchSchema.$defs.taskLinkedSnapshot.allOf[1].not.anyOf.some(value => value.required?.includes(forbidden)))
}
const taskStateRules = batchSchema.$defs.taskStateSnapshot.allOf[1].allOf
assert(!batchSchema.$defs.taskStateSnapshot.allOf[1].properties.state.enum.includes('queued'))
const runningRule = taskStateRules.find(rule => rule.if?.properties?.state?.const === 'running').then
assert(runningRule.required.includes('child_session_id') && runningRule.required.includes('job_id'))
for (const forbidden of ['receipt', 'failure_code']) {
  assert(runningRule.not.anyOf.some(value => value.required?.includes(forbidden)))
}
const imageStateRule = taskStateRules.find(rule => rule.if?.properties?.state?.enum?.includes('needs-review')).then
for (const required of ['child_session_id', 'job_id', 'receipt']) assert(imageStateRule.required.includes(required))
assert(!batchSchema.$defs.taskSnapshot.required.includes('child_session_id'))
assert(!batchSchema.$defs.taskSnapshot.required.includes('job_id'))
assert.deepEqual(batchSchema.$defs.eventBase.properties.kind.enum, ['created', 'task-linked', 'task-state', 'terminal'])
assert.equal(batchResultSchema.$defs.result.additionalProperties, false)
assert.equal(batchResultSchema.$defs.result.properties.tasks.minItems, 2)
assert.equal(batchResultSchema.$defs.result.properties.tasks.maxItems, 8)
assert.equal(batchResultSchema.$defs.receiptRef.properties.attachment, undefined, 'result receiptRef must be pointer-only')
assert.deepEqual(batchResultSchema.$defs.imageAttachmentRef.required, ['attachmentId', 'mediaType', 'bytes', 'width', 'height'])
assert.equal(batchResultSchema.$defs.image.properties.attachment.$ref, '#/$defs/imageAttachmentRef')
for (const source of [batchSchemaText, batchResultSchemaText]) {
  assert(!source.includes('\"attachment_id\"') && !source.includes('\"media_type\"'), 'schemas must not invent snake_case attachment keys')
}
assert(!batchResultSchemaText.includes('\"prompt\"'), 'durable batch result must not contain prompt text')
for (const required of ['run.localAgent !== undefined', 'run.id === run.localAgent.id', 'Session header', 'single-image provider/receipt path', 'images.length > 0 && failures.length > 0', 'exactly once in `images`', 'exactly once in `failures`']) {
  assert(adrText.includes(required), 'ADR missing reviewed invariant: ' + required)
}
assert(!adrText.includes('validates exact parent Session/call/task linkage, `localAgent`'))
assert(!adrText.includes('Every task invokes unchanged `imagegen`'))
for (const required of [
  'Raw arrays may be empty or contain duplicates', 'both parent and child normalize `image_url` identically',
  'deduplicated by first occurrence with order preserved', 'explicit `[]` is new-image',
  'batch path disables implicit history inference', 'Operation is recomputed from that normalized list',
]) assert(adrText.includes(required), 'ADR missing image_url normalization rule: ' + required)
for (const required of [
  'nonce lookup map', 'effect-owned active gate set', 'Atomic claim removes the nonce from the lookup map immediately',
  'claim does not remove the gate object from the active set', 'Only final cleanup removes it from the active set',
  'including already-claimed waiters and in-flight operations', 'stops new admission and worker refill',
  'surfaces the persistence failure', 'must never hang permanently',
]) assert(adrText.includes(required), 'ADR missing gate lifecycle rule: ' + required)
assert(!adrText.includes('removed on consume'))
assert(!adrText.includes('prevents downstream projection/slot progress'))
for (const id of ['EM217-002', 'EM217-103']) {
  const ticket = text(id)
  for (const required of ['nonce lookup', 'active gate set', 'claimed gate', 'final cleanup', 'disposal ownership']) {
    assert(ticket.includes(required), id + ' missing gate lifecycle rule: ' + required)
  }
}
for (const required of ['停止新 admission/refill', 'quiescent dispose active work', 'surface persistence failure', '不得永久 hang']) {
  assert(text('EM217-103').includes(required), 'EM217-103 missing persistence failure settlement: ' + required)
}
assert(text('EM217-003').includes('anywhere-labs/deepseek-harness-desktop@6074088f5b660206e404b3591fab51fb99c69add'))
assert(!text('EM217-003').includes(rejected.repository) && !text('EM217-003').includes(rejected.commit))
assert(text('EM217-002').includes('created event') && text('EM217-002').includes('task-linked') && text('EM217-002').includes('ctx.sessions.flush(parent.session)'))
assert(text('EM217-002').includes('spawn/localAgent') && text('EM217-002').includes('shared Attachment CAS'))
assert(text('EM217-002').includes('native SessionStore durability checkpoint'))
assert(text('EM217-002').includes('revision-3 review/adjudication'))
const batch101 = text('EM217-101')
const batch102 = text('EM217-102')
const batch103 = text('EM217-103')
const publicActivationPaths = [
  'packages/dsh/src/profile/image-generation.ts',
  'packages/dsh/src/profile/agent-operations.ts',
  'packages/dsh/src/profile/audit.ts',
  'packages/dsh-plugin-tool-search/cordis.patch.yml',
  'packages/dsh-plugin-tool-search/test/tool-search.test.mjs',
]
for (const id of ['EM217-101', 'EM217-102']) {
  assert(!t(id).write_set.some(path => publicActivationPaths.includes(path)), id + ' must not own public activation paths')
  assert(text(id).includes('focused test') && text(id).includes('不') && text(id).includes('model-visible'), id + ' must stay directly tested and internal')
}
assert.deepEqual(t('EM217-101').tests, ['node --test packages/dsh/test/image-batch-normalizer.test.mjs'])
assert.deepEqual(t('EM217-102').tests, ['node --test packages/dsh/test/image-batch-events.test.mjs'])
for (const path of publicActivationPaths) assert(t('EM217-103').write_set.includes(path), 'EM217-103 missing activation path ' + path)
for (const required of ['首次', '原子', 'new-image execution/result', 'durable event producer', '注册 model-visible image_batch', 'Tool Search visibility/aliases', 'audit canonical image-generation classification', '禁止 disconnected registration']) {
  assert(batch103.includes(required), 'EM217-103 missing atomic activation rule: ' + required)
}
assert(batch101.includes('prompt') && batch101.includes('image_url Attachment ID'))
assert(batch101.includes('不得接受或宣称 size/aspect/quality/model'))
assert(!batch101.includes('每个任务含 exact prompt、reference attachment IDs、size/aspect/quality'))
for (const required of ['允许 [] 与重复 ID', 'first-occurrence ordered unique ID list', '[] 为 new-image', 'operation 从 normalized refs 重算', '禁止 implicit history inference']) {
  assert(batch101.includes(required), 'EM217-101 missing image_url normalization rule: ' + required)
}
for (const required of ['explicit []', 'first-occurrence ordered unique ID list', '禁止 implicit history inference']) {
  assert(batch103.includes(required), 'EM217-103 missing image_url normalization rule: ' + required)
}
const worker104 = text('EM217-104')
assert.deepEqual(t('EM217-104').write_set, [
  'packages/dsh/src/profile/native-image-task-runner.ts',
  'packages/dsh/test/native-image-task-runner.test.mjs',
  'packages/dsh/test/image-batch-worker-stress.test.mjs',
])
for (const required of ['shared native-image-task-runner Promise worker loop', '默认 3、硬上限 4',
  '140 个 seeded interleavings', 'result inspection', 'run.dispose 完成后', 'runtime 保持不变',
  '不创建 image-batch-admission.ts', '第二 state owner', 'public registration']) {
  assert(worker104.includes(required), 'EM217-104 missing shared-worker rule: ' + required)
}
assert(!worker104.includes('admission hint 与本地资源共同决定'))
assert(!t('EM217-104').write_set.some(path => path.includes('image-batch-admission')), 'EM217-104 must not create a second admission owner')
const receipt106 = text('EM217-106')
assert(receipt106.includes('receipt 与 child projection 保持完全不变'))
assert(receipt106.includes('parent task link → existing child projection'))
assert(!receipt106.includes('receipt 增加 batch_id'))
assert(!t('EM217-106').write_set.some(path => path.includes('image-generation.ts')), 'EM217-106 must not claim receipt metadata work')
for (const required of ['exact child owner', 'authorized imagegen call_id', 'deterministic client_request_id', 'native Job', 'foreign/late/duplicate receipt']) {
  assert(receipt106.includes(required), 'EM217-106 missing exact receipt correlation rule: ' + required)
}
assert.deepEqual(t('EM217-106').write_set, [
  'packages/dsh/src/profile/native-image-task-runner.ts',
  'packages/dsh/test/*receipt*',
  'packages/dsh/test/native-image-task-runner.test.mjs',
  'docs/2.0.17/work-orders.json',
  'docs/2.0.17/check-plan.mjs',
])
const source105 = text('EM217-105')
assert(source105.includes('已由 EM217-109 覆盖') && source105.includes('只读兼容'), 'EM217-105 confirmation must stay superseded with historical read-only compatibility')
for (const required of ['shared CAS', 'Attachment refs', 'normalized IDs', 'userQuestions 路由到 parent', 'revision 2', 'revision 3', 'adjudication 全程占用并发槽', 'provider 前拒绝', '不得留下永久 needs-review', 'cleanup flush', 'image-review-persistence', 'provider_request_id', 'recorded billing']) {
  assert(source105.includes(required), 'EM217-105 missing source route rule: ' + required)
}
assert.deepEqual(t('EM217-105').write_set, [
  'packages/dsh/src/profile/image-batch.ts',
  'packages/dsh/src/profile/native-image-task-runner.ts',
  'packages/dsh/src/profile/image-generation.ts',
  'packages/dsh/test/**image-batch*',
  'packages/dsh/test/**prompt-fidelity*',
  'packages/dsh/test/e-mate.test.mjs',
  'docs/2.0.17/work-orders.json',
  'docs/2.0.17/check-plan.mjs',
])
const recovery107 = text('EM217-107')
for (const required of ['created/unlinked', 'interrupted/not-submitted', 'linked/nonterminal', 'unknown', 'provider POST=0', '绝不自动恢复、重试或重新启动']) {
  assert(recovery107.includes(required), 'EM217-107 missing recovery rule: ' + required)
}
assert(!recovery107.includes('queued task 重新启动'))
assert(recovery107.includes('durable projection'))
assert(recovery107.includes('native Session/Job'))
assert(recovery107.includes('legacy label/time fallback'))
assert(recovery107.includes('publicBatch view'))
assert(recovery107.includes('image_evidence/failures'))
assert(recovery107.includes('accepted_events'))
for (const required of ['flush true', 'refold', 'exact native session not-found', 'storage outage', 'malformed projection', 'normalized call args', 'operation/sources', 'revision-2/3 history', '不得写 receipt pointer/image', 'running/needs-review-only', 'recorded/not-submitted/unknown', 'evidence/failures 集合完整', 'ordinal 1..N', 'parent receipt revision 仅 2..3']) {
  assert(recovery107.includes(required), 'EM217-107 missing strict recovery rule: ' + required)
}
assert.deepEqual(t('EM217-107').write_set, [
  'packages/dsh/src/profile/image-batch-recovery.ts',
  'packages/dsh/src/profile/image-batch-events.ts',
  'packages/dsh/src/profile/native-image-task-runner.ts',
  'packages/dsh/src/profile/image-generation.ts',
  'packages/dsh/test/*recovery*',
  'packages/dsh/test/image-batch-events.test.mjs',
  'packages/dsh/test/image-batch-receipt-correlation.test.mjs',
  'packages/dsh/test/native-image-task-runner.test.mjs',
  'packages/dsh/test/image-batch-worker-stress.test.mjs',
  'docs/2.0.17/work-orders.json',
  'docs/2.0.17/check-plan.mjs',
])
const noReview109 = t('EM217-109')
assert.equal(noReview109.owner, 'IMG')
assert.deepEqual(noReview109.depends_on, ['EM217-105', 'EM217-107'])
assert.equal(noReview109.branch, 'feat/2.0.17/em217-109-no-image-confirmation')
assert.equal(noReview109.worktree, '/Users/mac/e-mate/worktrees/em217-109')
assert.deepEqual(noReview109.write_set, [
  'packages/dsh/src/profile/image-generation.ts',
  'packages/dsh/src/profile/native-image-task-runner.ts',
  'packages/dsh/test/native-image-task-runner.test.mjs',
  'packages/dsh/test/image-batch-receipt-correlation.test.mjs',
  'packages/dsh/test/e-mate.test.mjs',
  'docs/2.0.17/work-orders.json',
  'docs/2.0.17/check-plan.mjs',
])
for (const required of ['userQuestions lookup/ask', 'completed revision 2', 'semantic not-applicable', 'same-source', '历史 revision-2 needs-review/revision-3']) {
  assert(text('EM217-109').includes(required), 'EM217-109 missing no-confirmation rule: ' + required)
}

const latency108 = t('EM217-108')
assert.equal(latency108.owner, 'IMG')
assert.equal(latency108.evidence_owner, 'QA')
assert.deepEqual(latency108.depends_on, ['EM217-107', 'EM217-202'])
assert.equal(latency108.branch, 'feat/2.0.17/em217-108-single-image-latency')
assert.equal(latency108.worktree, '/Users/mac/e-mate/worktrees/em217-108')
assert.equal(latency108.performance_evidence.status, 'OPEN')
assert.equal(latencyManifest.ticket, 'EM217-108')
assert.equal(latencyManifest.status, 'OPEN')
assert.equal(latencyManifest.provenance, null)
assert.equal(latencyManifest.results, null)
assert.equal(latencyManifest.external_raw.uri, null)
assert.equal(latencyManifest.external_raw.sha256, null)
assert.equal(latencyManifest.gui_first_visible.status, 'OPEN')
assert.equal(latencyManifest.gui_first_visible.p95_limit_ms, 500)
for (const path of ['../../tests/performance/image-single/protocol.mjs', '../../tests/performance/image-single/fixtures.mjs', '../../tests/performance/image-single/worker.mjs', '../../tests/performance/image-single/benchmark.mjs', '../../tests/performance/image-single/contract.test.mjs']) await access(new URL(path, here))
assert(latency108.tests.includes('node --test tests/performance/image-single/contract.test.mjs'))
assert(latency108.tests.includes('node tests/performance/image-single/benchmark.mjs --source-smoke'))
assert(latency108.tests.includes('MAIN-AGENT-ONLY SOURCE PREREQUISITE: corepack pnpm run build:harness'))
assert(latency108.tests.includes('MAIN-AGENT-ONLY SOURCE-GATED: corepack pnpm --filter @e-mate/dsh build'))
assert(latency108.tests.includes('MAIN-AGENT-ONLY PERFORMANCE GATE: node tests/performance/image-single/benchmark.mjs'))
assert(latency108.tests.indexOf('MAIN-AGENT-ONLY SOURCE-GATED: corepack pnpm --filter @e-mate/dsh build') < latency108.tests.indexOf('MAIN-AGENT-ONLY PERFORMANCE GATE: node tests/performance/image-single/benchmark.mjs'))
assert.deepEqual(latency108.write_set, [
  'docs/2.0.17/contracts/single-image-latency.md',
  'tests/performance/image-single/**',
  'docs/2.0.17/evidence-manifests/single-image-latency.json',
  'packages/dsh/test/e-mate.test.mjs',
  'packages/dsh/src/profile/image-generation.ts',
])
assert(text('EM217-108').includes('只有 benchmark 证明超界的 stage 才可在后续修改 image-generation.ts'))
for (const required of [
  'no native image-generation Tool', 'pinned-owner lower bound', 'in-process fake provider response delayed exactly 25 ms',
  '20 untimed warmups followed by 60 paired samples', '15 paired samples', '30 paired small-output samples',
  'Run three fresh processes', 'nearest-rank p95 and p99', 'zero subagents', 'zero `emate/image-batch` events',
  'exactly one native Job', 'zero retry and zero admission wait', 'max(75 ms, 15%)', 'max(1500 ms, 50%)',
  '75 ms p95 and 150 ms p99', 'p95 no greater than 500 ms', 'Only a stage proven by this benchmark',
  'Each worker emits at most 2 MiB of JSON', 'work/em217-108/image-single/',
]) assert(latencyContractText.includes(required), 'single-image latency contract missing ' + required)
for (const required of ['prompt text, image or base64 bytes', 'product code gains no benchmark mode, delay, or flag']) {
  assert(latencyContractText.includes(required), 'single-image latency contract missing prohibition: ' + required)
}
assert(regressionText.includes('NEW-IMG-LATENCY-001'))
assert(ownersText.includes('101 → 102 → 103 → 104 → 105 → 106 → 107 → 108'))
const qa501 = text('EM217-501')
assert(t('EM217-501').depends_on.includes('EM217-108'))
assert(t('EM217-501').depends_on.includes('EM217-109'))
assert(qa501.includes('EM217-108 direct single-image bypass'))
for (const required of ['zero userQuestions', 'completed revision 2', 'semantic not-applicable', 'no human_review', 'same-source safety', '历史 revision 2 needs-review/revision 3', 'created/unlinked=interrupted/not-submitted', 'linked/nonterminal=unknown', '不得自动 resume/retry']) {
  assert(qa501.includes(required), 'EM217-501 missing adversarial rule: ' + required)
}
for (const ticket of tickets) for (const path of ticket.write_set) assert(!path.includes('enterprise/apps/model-gateway/test/**'), ticket.id + ' uses singular gateway test path')
assert.deepEqual(t('EM217-203').depends_on, ['EM217-201'])
assert.deepEqual(t('EM217-202').depends_on, ['EM217-201', 'EM217-203'])
const observability204 = t('EM217-204')
assert(observability204.depends_on.includes('EM217-202'))
assert.deepEqual(observability204.write_set, [
  'enterprise/apps/model-gateway/src/**',
  'enterprise/apps/model-gateway/tests/**',
  'packages/dsh/src/profile/image-generation.ts',
  'packages/dsh/src/profile/native-image-task-runner.ts',
  'packages/dsh/src/profile/audit.ts',
  'packages/dsh/test/e-mate.test.mjs',
  'packages/dsh/test/native-image-task-runner.test.mjs',
  'docs/2.0.17/observability/image-batch.md',
])
assert(text('EM217-204').includes('parent_projection_append'))
assert(!text('EM217-204').includes('packages/dsh/src/profile/image-batch.ts'))
assert(!text('EM217-204').includes('packages/dsh-plugin-tool-search'))
const projectionVisibleMentions = [...observability204.implementation, ...observability204.acceptance]
  .filter(statement => statement.includes('projection_visible'))
assert(projectionVisibleMentions.length > 0)
assert(projectionVisibleMentions.every(statement => statement.includes('OPEN')),
  'EM217-204 may mention projection_visible only as explicitly OPEN')
assert(observability204.acceptance.some(statement => statement.includes('first paint') && statement.includes('OPEN')
  && statement.includes('EM217-301') && statement.includes('EM217-108')))
assert(t('EM217-205').depends_on.includes('EM217-204'))
const recovery206 = t('EM217-206')
assert.equal(recovery206.owner, 'AUTH')
assert.deepEqual(recovery206.depends_on, ['EM217-205', 'EM217-406'])
assert.equal(recovery206.branch, 'feat/2.0.17/em217-206-enterprise-offline-auth')
assert.equal(recovery206.worktree, '/Users/mac/e-mate/worktrees/em217-206')
assert.equal(recovery206.evidence.status, 'OPEN')
assert(recovery206.write_set.includes('enterprise/apps/model-gateway/src/postgres-usage-store.ts'))
assert(!recovery206.write_set.includes('enterprise/apps/model-gateway/src/tenant-model-route-policy.ts'))
const em206NewPaths = new Set([
  'packages/dsh/profile/plugins/emate-shell/tests/enterprise-model-recovery.client.spec.tsx',
  'docs/2.0.17/contracts/enterprise-model-recovery.md',
])
for (const path of recovery206.write_set.filter(path => !em206NewPaths.has(path))) {
  await assert.doesNotReject(
    access(new URL(`../../${path}`, here)),
    'EM217-206 invented a source owner path: ' + path,
  )
}
assert(t('EM217-501').depends_on.includes('EM217-206'))
for (const required of [
  'management/control', 'Gateway data-plane', 'provider', 'Postgres', 'warm/cold', 'Renderer health',
  'Session list/open/history', 'Workspace', 'attachments', 'local Tools', 'expired/revoked',
  'Gateway-routed OpenAI-compatible', 'model-session credential', 'provider POST=0', 'key A→B',
  'online/focus', 'credential-generation', '<=30', 'coalesced', 'direct-provider fallback', 'OPEN',
]) assert(JSON.stringify(recovery206).includes(required), 'EM217-206 missing ' + required)
for (const required of [
  'Management/control-plane outage', 'Gateway data-plane outage', 'Provider outage', 'Postgres outage',
  'exp - 1', 'exp', 'Session revoke or user disable', 'User model-list change',
  'Route disable/unpublish then re-enable', 'Tenant key A to B rotation',
  'Delayed refresh/catalog A versus logout/login B', 'Gateway starts while Postgres is down',
  'no direct-provider fallback', 'Missing fault, reconnect, live-Postgres, gateway-startup, or installed evidence stays **OPEN**',
]) assert(enterpriseRecoveryText.includes(required), 'enterprise recovery contract missing ' + required)
assert(ownersText.includes('| AUTH |'))
assert(regressionText.includes('NEW-ENT-RECOVERY-001'))
assert(text('EM217-501').includes('EM217-206 is in the dependency closure'))
assert(text('EM217-202').includes('enterprise/apps/model-gateway/tests/model-gateway-contract.test.ts'))
assert(text('EM217-202').includes('USER_TOKEN_LIMIT') && text('EM217-202').includes('malformed success'))
const computerUse = text('EM217-408')
for (const required of ['2fbf383b49fe08e466d4d1caba659fb42b61de6b', '76bfe8607f61945c1cbb84e73976e601100c13a2', 'ctx.computerUse', '单一 Profile row', 'app+HWND+PID', 'UIA state hash', 'key/button cleanup', 'policy-never', 'per-turn lease', 'one-use', 'workspace fence', '固定 DSH subprocess', 'post-action observation', 'secure desktop', 'UIPI', 'elevated', 'locked', 'RDP', 'src/index.js Tool registry', 'process-global approval Set', 'computer_set_mode', 'raw spawn', 'arbitrary path/output', 'LLM output-guard']) assert(computerUse.includes(required), 'EM217-408 missing ' + required)
assert(t('EM217-408').tests.includes('MAIN-AGENT-ONLY COMPONENT CHECK: node scripts/component-run.mjs check --component @e-mate/dsh-plugin-computer-use'))
assert(!computerUse.includes('--filter @e-mate/dsh-plugin-computer-use'), 'EM217-408 standalone component must not use root --filter')
assert(executionText.includes('node scripts/component-run.mjs check --component @e-mate/dsh-plugin-computer-use'))
assert(executionText.includes('node_modules/.bin/vitest'))
for (const line of executionText.split('\n').filter(line => line.includes('pnpm exec'))) {
  assert(line.includes('不得使用'), 'pnpm exec may appear only as rejected EM217-307 guidance')
}
assert.equal(t('EM217-408').installed_machine_evidence.status, 'OPEN')
assert.equal(t('EM217-408').installed_machine_evidence.confirmation_required, true)
assert(!t('EM217-408').write_set.some(path => path.includes('focused existing') || path.includes('对应')))
for (const id of ['EM217-407', 'EM217-505']) assert(t(id).depends_on.includes('EM217-408'), id + ' must depend on EM217-408')
assert(t('EM217-407').depends_on.includes('EM217-501'))
assert.deepEqual(t('EM217-504').depends_on, ['EM217-407', 'EM217-501'])
assert.deepEqual(t('EM217-504').production_requires, ['EM217-502', 'EM217-503'])
assert(!Object.hasOwn(t('EM217-504').gate, 'production_requires'), 'EM217-504 gate must not duplicate production_requires')
assert.equal(t('EM217-504').gate.confirmation_required, true)
assert(ownersText.includes('201 → 203 → 202 → 204 → 205'), 'owners.md GW order must match accepted DAG')
const em404 = t('EM217-404')
for (const path of ['scripts/harness-provenance.mjs', 'scripts/harness-provenance.test.mjs']) {
  assert(em404.write_set.includes(path), 'EM217-404 missing provenance owner path ' + path)
}
const overlay = '@deepseek-ai/dsh-app-boot@npm:0.1.0-rc.7'
assert(text('EM217-404').includes(overlay), 'EM217-404 must admit the exact pinned app-boot overlay')
assert(text('EM217-404').includes('唯一 Harness provenance owner'))
assert(text('EM217-404').includes('其他版本、包或浮动引用继续 fail closed'))
assert.deepEqual(em404.tests, [
  'node --test scripts/harness-provenance.test.mjs',
  'workdir: desktop; corepack yarn check',
])
assert(executionText.includes('Desktop Harness overlay is not admitted: ' + overlay))
assert(executionText.indexOf('node --test scripts/harness-provenance.test.mjs') < executionText.indexOf('workdir: desktop; corepack yarn check'))
const harnessBuild = 'MAIN-AGENT-ONLY SOURCE PREREQUISITE: corepack pnpm run build:harness'
for (const ticket of tickets) {
  const full = ticket.tests.findIndex(command => command.includes('corepack pnpm run test:fast') || command.includes('corepack pnpm test'))
  if (full >= 0) {
    assert.equal(ticket.tests[0], harnessBuild, ticket.id + ' must build pinned Harness first')
    assert(full > 0, ticket.id + ' full test must follow build:harness')
  }
}
assert(executionText.indexOf('corepack pnpm run build:harness') < executionText.indexOf('corepack pnpm run test:fast'))
for (const id of ['EM217-504', 'EM217-505', 'EM217-506', 'EM217-507']) {
  assert.equal(t(id).gate?.confirmation_required, true, id + ' production gate confirmation')
  assert.equal(t(id).gate?.status, 'OPEN', id + ' gate must remain OPEN')
}
for (const source of [ordersText, executionText]) {
  assert(!source.includes('corepack yarn --cwd desktop'), 'Desktop Yarn must not run through root Corepack')
  for (const line of source.split('\n').filter(line => line.includes('COREPACK_ENABLE_PROJECT_SPEC=0'))) {
    assert(line.includes('不得使用') || line.includes('不是 canonical guidance'), 'Corepack project-spec bypass must appear only as rejected guidance')
  }
  for (const line of source.split('\n').filter(line => line.includes('corepack yarn'))) {
    assert(line.includes('workdir: desktop; corepack yarn'), 'Desktop Yarn command must declare workdir: desktop')
  }
}
assert(executionText.includes('workdir: desktop; corepack yarn check'))
for (const command of ['workdir: desktop; corepack yarn check', 'workdir: desktop; corepack yarn dist:mac', 'workdir: desktop; corepack yarn dist:win']) {
  assert(ordersText.includes(command), 'work orders missing Desktop command: ' + command)
}
console.log('EM217 plan check passed: 42 tickets, exact pins, enterprise recovery and single-image latency gates, corrected component commands, acyclic dependencies, WIP <= 6, and gates OPEN.')
