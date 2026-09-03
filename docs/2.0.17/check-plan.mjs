#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const here = new URL('.', import.meta.url)
const [
  baselineText, ordersText, executionText, ownersText, regressionText, adrText,
  batchSchemaText, batchResultSchemaText, latencyContractText, fileImportHostText,
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
  readFile(new URL('../../packages/dsh-plugin-file-import/src/index.ts', here), 'utf8'),
])
const baseline = JSON.parse(baselineText)
const orders = JSON.parse(ordersText)
const batchSchema = JSON.parse(batchSchemaText)
const batchResultSchema = JSON.parse(batchResultSchemaText)
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
const expectedIds = ['EM217-000', 'EM217-001', 'EM217-002', 'EM217-003', 'EM217-004', 'EM217-101', 'EM217-102', 'EM217-103', 'EM217-104', 'EM217-105', 'EM217-106', 'EM217-107', 'EM217-108', 'EM217-201', 'EM217-202', 'EM217-203', 'EM217-204', 'EM217-205', 'EM217-301', 'EM217-302', 'EM217-303', 'EM217-304', 'EM217-305', 'EM217-306', 'EM217-307', 'EM217-401', 'EM217-402', 'EM217-403', 'EM217-404', 'EM217-405', 'EM217-406', 'EM217-407', 'EM217-408', 'EM217-501', 'EM217-502', 'EM217-503', 'EM217-504', 'EM217-505', 'EM217-506', 'EM217-507']
assert.equal(tickets.length, 40)
assert.equal(new Set(ids).size, 40)
assert.deepEqual([...ids].sort(), [...expectedIds].sort())
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
assert(worker104.includes('默认 3、硬上限 4'))
assert(worker104.includes('不发送也不拥有本地 scheduling hint'))
assert(worker104.includes('result inspection') && worker104.includes('dispose 完成后 refill'))
assert(!worker104.includes('admission hint 与本地资源共同决定'))
const receipt106 = text('EM217-106')
assert(receipt106.includes('receipt 与 child projection 保持完全不变'))
assert(receipt106.includes('parent task link → existing child projection'))
assert(!receipt106.includes('receipt 增加 batch_id'))
assert(!t('EM217-106').write_set.some(path => path.includes('image-generation.ts')), 'EM217-106 must not claim receipt metadata work')
const source105 = text('EM217-105')
for (const required of ['shared CAS', 'Attachment refs', 'normalized IDs', 'userQuestions 路由到 parent', 'revision 2', 'revision 3', 'adjudication 全程占用并发槽', 'provider 前拒绝', '不得留下永久 needs-review']) {
  assert(source105.includes(required), 'EM217-105 missing source route rule: ' + required)
}
const recovery107 = text('EM217-107')
for (const required of ['created/unlinked', 'interrupted/not-submitted', 'linked/nonterminal', 'unknown', 'provider POST=0', '绝不自动恢复、重试或重新启动']) {
  assert(recovery107.includes(required), 'EM217-107 missing recovery rule: ' + required)
}
assert(!recovery107.includes('queued task 重新启动'))
const latency108 = t('EM217-108')
assert.equal(latency108.owner, 'IMG')
assert.equal(latency108.evidence_owner, 'QA')
assert.deepEqual(latency108.depends_on, ['EM217-107', 'EM217-202'])
assert.equal(latency108.branch, 'feat/2.0.17/em217-108-single-image-latency')
assert.equal(latency108.worktree, '/Users/mac/e-mate/worktrees/em217-108')
assert.equal(latency108.performance_evidence.status, 'OPEN')
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
]) assert(latencyContractText.includes(required), 'single-image latency contract missing ' + required)
for (const required of ['prompt text, image or base64 bytes', 'product code gains no benchmark mode, delay, or flag']) {
  assert(latencyContractText.includes(required), 'single-image latency contract missing prohibition: ' + required)
}
assert(regressionText.includes('NEW-IMG-LATENCY-001'))
assert(ownersText.includes('101 → 102 → 103 → 104 → 105 → 106 → 107 → 108'))
const qa501 = text('EM217-501')
assert(t('EM217-501').depends_on.includes('EM217-108'))
assert(qa501.includes('EM217-108 direct single-image bypass'))
for (const required of ['parent userQuestions 不可用时 provider 前拒绝', 'revision 2', 'revision 3', '无永久 needs-review', 'created/unlinked=interrupted/not-submitted', 'linked/nonterminal=unknown', '不得自动 resume/retry']) {
  assert(qa501.includes(required), 'EM217-501 missing adversarial rule: ' + required)
}
for (const ticket of tickets) for (const path of ticket.write_set) assert(!path.includes('enterprise/apps/model-gateway/test/**'), ticket.id + ' uses singular gateway test path')
assert.deepEqual(t('EM217-203').depends_on, ['EM217-201'])
assert.deepEqual(t('EM217-202').depends_on, ['EM217-201', 'EM217-203'])
assert(t('EM217-204').depends_on.includes('EM217-202'))
assert(t('EM217-205').depends_on.includes('EM217-204'))
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
console.log('EM217 plan check passed: 40 tickets, exact pins, single-image latency gate, corrected component commands, acyclic dependencies, WIP <= 6, and gates OPEN.')
