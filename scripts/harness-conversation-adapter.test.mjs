import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { adaptHarnessConversationSource } from './harness-conversation-adapter.mjs'

const native = readFileSync(new URL('../upstream/deepseek-harness/packages/client/ui-conversation/lib/client.js', import.meta.url), 'utf8')
const adapted = adaptHarnessConversationSource(native)

// Execute the actual transformed native machine/facade/hub. The only fixture is
// its observable-store dependency; no substitute input machine or send path.
const section = (start, end) => adapted.slice(adapted.indexOf(start), adapted.indexOf(end))
const owners = new Function('_deepseek_ai_dsh_client_runtime_client', [
  section('function emateDraftFiles(', '\t\t//#endregion'),
  section('\t\t//#region lib/types/client/queue/store.js', '\t\t//#region ../../../vendor/cosmokit/src/misc.ts'),
  'return { SessionInputShell, InputHub, createChatStore, emateImportedText, emateFileDisplay, emateQueuePreview }',
].join('\n'))({
  defineStore: value => value,
  createSnapshotStore(initial) {
    let state = initial
    return { getSnapshot: () => state, set: value => { state = value }, subscribe: () => () => {} }
  },
})

const file = (stored = '报告_带空格_验证.txt', display = '报告 带空格@验证.txt') => ({
  stored_name: stored, display_name: display, media_type: 'text/plain', relative_path: '.e-mate/imports/' + stored,
})
function setup(sendSession = async () => {}) {
  const conversation = { sendSession, releaseDraftImage() {} }
  const hub = new owners.InputHub({ get: name => name === 'conversation' ? conversation : undefined }, value => value)
  const session = { sessionId: 'one' }
  const shell = new owners.SessionInputShell({
    actx: {}, defaultSink: (text, ids, mode, mentions) => hub.sink(session, text, ids, mode, mentions),
  })
  hub.shells.set('one', shell)
  return { shell, hub }
}

test('every pinned seam fails closed on missing, duplicate or already adapted input', () => {
  assert.throws(() => adaptHarnessConversationSource('future'), /expected one rc\.7 seam/u)
  assert.throws(() => adaptHarnessConversationSource(native + native), /found 2/u)
  assert.throws(() => adaptHarnessConversationSource(adapted), /expected one rc\.7 seam/u)
  assert.match(adapted, /const empty = .*input\?\.fileRefs.length/u)
  assert.match(adapted, /inputActions.restoreDraft\(storedDraft, storedFiles \?\? \[\]\)/u)
})

test('native scoped chat store persists one file list, cold restores names, and removes only the selected ref', () => {
  const store = owners.createChatStore()
  assert.equal(store.persist, 'dsh.conversation.chat')
  const persisted = store.init()
  const { shell } = setup()
  shell.bindMirror((text, files) => store.actions.setDraft(persisted, text, files))
  shell.addFiles([file(), file('报告_带空格_验证-2.txt')], '请读')
  assert.equal(shell.snapshot.draft, '请读')
  assert.equal(persisted.fileRefs.length, 2)
  const cold = setup().shell
  cold.restoreDraft(persisted.draft, JSON.parse(JSON.stringify(persisted.fileRefs)))
  assert.equal(cold.snapshot.fileRefs[0].display_name, '报告 带空格@验证.txt')
  cold.removeFile(file().relative_path)
  assert.deepEqual(cold.snapshot.fileRefs.map(value => value.stored_name), ['报告_带空格_验证-2.txt'])
  assert.equal(cold.snapshot.draft, '请读')
  assert.equal(shell.snapshot.fileRefs.length, 2)
  assert.throws(() => cold.addFiles([{ ...file(), relative_path: '../secret.txt' }]), /附件草稿无效/u)
  const damaged = setup().shell
  damaged.restoreDraft('正文必须保留', [{ ...file(), relative_path: '../secret.txt' }])
  assert.equal(damaged.snapshot.draft, '正文必须保留')
  assert.match(damaged.notices.getSnapshot().text, /附件草稿无法恢复/u)
})

test('file-only submit and mixed steering use the native sink and exact paths', async () => {
  const sent = []
  const { shell } = setup(async (...args) => { sent.push(args) })
  shell.addFiles([file()])
  shell.submit()
  assert.equal(sent[0][1], '@.e-mate/imports/报告_带空格_验证.txt')
  assert.equal(sent[0][3], 'queue')
  assert.deepEqual(Object.keys(sent[0][4][0]), ['source', 'ref'])
  assert.equal(JSON.parse(sent[0][4][0].ref).display_name, '报告 带空格@验证.txt')
  assert.deepEqual(shell.snapshot.fileRefs, [])
  shell.addFiles([file('next.txt', 'next.txt')])
  shell.addImages(['native-image'])
  shell.setDraft('继续')
  shell.submit('steer')
  assert.equal(sent[1][1], '继续\n@.e-mate/imports/next.txt')
  assert.deepEqual(sent[1][2], ['native-image'])
  assert.equal(sent[1][3], 'steer')
})

test('failed native send restores files and images without overwriting subsequent edits or crossing sessions', async () => {
  let reject
  const { shell, hub } = setup(() => new Promise((_resolve, fail) => { reject = fail }))
  shell.addFiles([file()])
  shell.addImages(['native-image'])
  shell.setDraft('原文')
  shell.submit()
  shell.setDraft('发送后编辑')
  shell.addFiles([file('new.txt', 'new.txt')])
  reject(new Error('offline'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(shell.snapshot.draft, '发送后编辑')
  assert.equal(shell.snapshot.fileRefs.length, 2)
  assert.deepEqual(shell.snapshot.imageIds, ['native-image'])
  shell.setDraft('')
  shell.submit()
  reject(new Error('offline'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(shell.snapshot.draft, '')
  assert.equal(shell.snapshot.fileRefs.length, 2)
  shell.submit()
  const replacement = setup().shell
  hub.shells.set('one', replacement)
  reject(new Error('gone'))
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(replacement.snapshot.fileRefs, [])
})

test('pending steering and queue projection hide import paths while native queue edits retain them', async () => {
  const raw = `请读\n@${file().relative_path}`
  assert.equal(owners.emateFileDisplay(raw), '请读\n报告_带空格_验证.txt')
  const row = { content: [{ type: 'image' }, { type: 'text', text: raw }], preview: 'unused', text: null }
  assert.equal(owners.emateQueuePreview(row), '[image] 请读 报告_带空格_验证.txt')
  const editing = { id: 'queued-one', ...owners.emateImportedText(raw) }
  editing.text = '编辑后的正文'
  const at = adapted.indexOf('const saveEdit = async () => {')
  const body = adapted.slice(at, adapted.indexOf('\n\t\t\treturn (0, react_jsx_runtime.jsx)', at))
  let saved
  await new Function('editing', 'applyAction', 't', 'setEditing', `${body}\nreturn saveEdit();`)(
    editing, async (_id, action) => { saved = action; return true }, value => value, () => {},
  )
  assert.equal(saved.content[0].text, `编辑后的正文\n@${file().relative_path}`)
  assert.match(adapted, /children: emateQueuePreview\(row\)/u)
  assert.match(adapted, /\.\.\.editing,\s+text: event.currentTarget.value/u)
})

test('packaged runtime verifies the adapter and actual client hashes instead of falling back', () => {
  const directory = mkdtempSync(join(tmpdir(), 'emate-conversation-provenance-'))
  try {
    const source = readFileSync(new URL('../packages/dsh/src/e-mate.ts', import.meta.url), 'utf8')
    const body = source.slice(source.indexOf('function harnessFromPackage() {'), source.indexOf('\nexport function resolveHarness()'))
    const resolvePackage = new Function('packageRoot', 'join', 'existsSync', 'readJson', 'createHash', 'readFileSync', `${body}\nreturn harnessFromPackage;`)(
      directory, join, existsSync, path => JSON.parse(readFileSync(path, 'utf8')), createHash, readFileSync,
    )
    const root = join(directory, 'runtime/harness')
    const client = join(root, 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js')
    mkdirSync(join(root, 'apps/cli/lib'), { recursive: true })
    mkdirSync(join(root, 'node_modules/@deepseek-ai/dsh-client-ui-conversation/lib'), { recursive: true })
    writeFileSync(join(root, 'apps/cli/lib/bin.js'), '')
    writeFileSync(join(root, 'apps/cli/package.json'), JSON.stringify({ version: '0.1.0-rc.7' }))
    const adapter = readFileSync(new URL('./harness-conversation-adapter.mjs', import.meta.url))
    writeFileSync(join(root, 'e-mate-conversation-adapter.mjs'), adapter)
    writeFileSync(client, adapted)
    const digest = bytes => createHash('sha256').update(bytes).digest('hex')
    const manifest = { commit: 'pinned', conversation_adapter_sha256: digest(adapter), conversation_client_sha256: digest(adapted) }
    writeFileSync(join(directory, 'runtime/source-manifest.json'), JSON.stringify(manifest))
    assert.equal(resolvePackage().source, 'packaged-runtime')
    writeFileSync(client, native)
    assert.throws(resolvePackage, /provenance is missing or mismatched/u)
    writeFileSync(client, adapted)
    writeFileSync(join(root, 'e-mate-conversation-adapter.mjs'), 'changed')
    assert.throws(resolvePackage, /provenance is missing or mismatched/u)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
