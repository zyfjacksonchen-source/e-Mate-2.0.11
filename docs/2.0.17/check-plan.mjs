#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const here = new URL('.', import.meta.url)
const [baselineText, ordersText, executionText, ownersText] = await Promise.all([
  readFile(new URL('baseline-lock.json', here), 'utf8'),
  readFile(new URL('work-orders.json', here), 'utf8'),
  readFile(new URL('execution-plan.md', here), 'utf8'),
  readFile(new URL('owners.md', here), 'utf8'),
])
const baseline = JSON.parse(baselineText)
const orders = JSON.parse(ordersText)
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
const expectedIds = ['EM217-000', 'EM217-001', 'EM217-002', 'EM217-003', 'EM217-004', 'EM217-101', 'EM217-102', 'EM217-103', 'EM217-104', 'EM217-105', 'EM217-106', 'EM217-107', 'EM217-201', 'EM217-202', 'EM217-203', 'EM217-204', 'EM217-205', 'EM217-301', 'EM217-302', 'EM217-303', 'EM217-304', 'EM217-305', 'EM217-306', 'EM217-401', 'EM217-402', 'EM217-403', 'EM217-404', 'EM217-405', 'EM217-406', 'EM217-407', 'EM217-408', 'EM217-501', 'EM217-502', 'EM217-503', 'EM217-504', 'EM217-505', 'EM217-506', 'EM217-507']
assert.equal(tickets.length, 38)
assert.equal(new Set(ids).size, 38)
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
assert(text('EM217-003').includes('anywhere-labs/deepseek-harness-desktop@6074088f5b660206e404b3591fab51fb99c69add'))
assert(!text('EM217-003').includes(rejected.repository) && !text('EM217-003').includes(rejected.commit))
assert(text('EM217-002').includes('created event') && text('EM217-002').includes('task-linked') && text('EM217-002').includes('ctx.sessions.flush(parent.session)'))
assert(text('EM217-002').includes('spawn/localAgent') && text('EM217-002').includes('shared Attachment CAS'))
assert(text('EM217-002').includes('native SessionStore durability checkpoint'))
assert(text('EM217-002').includes('revision-3 review/adjudication'))
const batch101 = text('EM217-101')
assert(batch101.includes('prompt') && batch101.includes('image_url Attachment ID'))
assert(batch101.includes('不得接受或宣称 size/aspect/quality/model'))
assert(batch101.includes('packages/dsh/src/profile/agent-operations.ts'))
assert(batch101.includes('packages/dsh/src/profile/audit.ts'))
assert(batch101.includes('packages/dsh-plugin-tool-search/cordis.patch.yml'))
assert(batch101.includes('canonical image-generation first-party plugin/scenario'))
assert(!batch101.includes('每个任务含 exact prompt、reference attachment IDs、size/aspect/quality'))
const worker104 = text('EM217-104')
assert(worker104.includes('默认 3、硬上限 4'))
assert(worker104.includes('不发送也不拥有本地 scheduling hint'))
assert(worker104.includes('result inspection') && worker104.includes('dispose 完成后 refill'))
assert(!worker104.includes('admission hint 与本地资源共同决定'))
const receipt106 = text('EM217-106')
assert(receipt106.includes('receipt 与 child projection 保持完全不变'))
assert(receipt106.includes('parent task link → existing child projection'))
assert(!receipt106.includes('receipt 增加 batch_id'))
for (const ticket of tickets) for (const path of ticket.write_set) assert(!path.includes('enterprise/apps/model-gateway/test/**'), ticket.id + ' uses singular gateway test path')
assert.deepEqual(t('EM217-203').depends_on, ['EM217-201'])
assert.deepEqual(t('EM217-202').depends_on, ['EM217-201', 'EM217-203'])
assert(t('EM217-204').depends_on.includes('EM217-202'))
assert(t('EM217-205').depends_on.includes('EM217-204'))
assert(text('EM217-202').includes('enterprise/apps/model-gateway/tests/model-gateway-contract.test.ts'))
assert(text('EM217-202').includes('USER_TOKEN_LIMIT') && text('EM217-202').includes('malformed success'))
const computerUse = text('EM217-408')
for (const required of ['2fbf383b49fe08e466d4d1caba659fb42b61de6b', '76bfe8607f61945c1cbb84e73976e601100c13a2', 'ctx.computerUse', '单一 Profile row', 'app+HWND+PID', 'UIA state hash', 'key/button cleanup', 'policy-never', 'per-turn lease', 'one-use', 'workspace fence', '固定 DSH subprocess', 'post-action observation', 'secure desktop', 'UIPI', 'elevated', 'locked', 'RDP', 'src/index.js Tool registry', 'process-global approval Set', 'computer_set_mode', 'raw spawn', 'arbitrary path/output', 'LLM output-guard']) assert(computerUse.includes(required), 'EM217-408 missing ' + required)
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
console.log('EM217 plan check passed: 38 tickets, exact pins, corrected native owners, acyclic dependencies, WIP <= 6, and gates OPEN.')
