import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { apply, importIntoWorkspace } from '../lib/index.js'
import { allowedMediaType, appendImportedMentions, CHANNEL, MAX_FILES } from '../lib/contract.js'

async function mounted(workspace) {
  let handler
  let options
  apply({
    effect(register) { register() },
    connection: { rpc: { handle(channel, next, nextOptions) {
      assert.equal(channel, CHANNEL)
      handler = next
      options = nextOptions
      return () => {}
    } } },
    workspaceRegistry: { list: () => [{ path: workspace, sessionIds: ['session-1'] }] },
  })
  return { handler, options }
}

const encoded = (name, text = 'content') => ({
  name,
  media_type: 'application/octet-stream',
  bytes_base64: Buffer.from(text).toString('base64'),
})

test('imports an allowlisted file atomically into the session workspace without exposing a host path', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'emate-file-import-'))
  const { handler, options } = await mounted(workspace)
  assert.deepEqual(options, { authority: 'loopback' })

  const first = await handler('import', { session_id: 'session-1', files: [encoded('Quarterly Report.docx')] }, new AbortController().signal)
  assert.equal(first.ok, true)
  assert.deepEqual(first.value.files[0], {
    bytes: 7,
    display_name: 'Quarterly Report.docx',
    media_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    relative_path: '.e-mate/imports/Quarterly_Report.docx',
    stored_name: 'Quarterly_Report.docx',
  })
  assert.equal(await readFile(join(workspace, first.value.files[0].relative_path), 'utf8'), 'content')
  assert.doesNotMatch(JSON.stringify(first.value), /sha256|\/private\/|\\Users\\/u)

  const second = await handler('import', { session_id: 'session-1', files: [encoded('Quarterly Report.docx', 'again')] }, new AbortController().signal)
  assert.equal(second.value.files[0].relative_path, '.e-mate/imports/Quarterly_Report-2.docx')
})

test('fails closed for unknown sessions, scripts, installers, malformed bytes and oversized batches', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'emate-file-import-boundary-'))
  const { handler } = await mounted(workspace)
  const signal = new AbortController().signal
  assert.equal((await handler('import', { session_id: 'missing', files: [encoded('note.txt')] }, signal)).ok, false)
  for (const name of ['run.sh', 'setup.exe', 'install.pkg', 'macro.ps1', 'script.js']) {
    assert.equal((await handler('import', { session_id: 'session-1', files: [encoded(name)] }, signal)).ok, false)
  }
  assert.equal((await handler('import', { session_id: 'session-1', files: [{ ...encoded('note.txt'), bytes_base64: '**' }] }, signal)).ok, false)
  assert.equal((await handler('import', { session_id: 'session-1', files: Array.from({ length: MAX_FILES + 1 }, (_, index) => encoded(`${index}.txt`)) }, signal)).ok, false)
})

test('rejects a symlinked managed directory', { skip: process.platform === 'win32' }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'emate-file-import-link-'))
  const outside = await mkdtemp(join(tmpdir(), 'emate-file-import-outside-'))
  await mkdir(join(workspace, '.e-mate'))
  await symlink(outside, join(workspace, '.e-mate', 'imports'))
  const { handler } = await mounted(workspace)
  const result = await handler('import', { session_id: 'session-1', files: [encoded('note.txt')] }, new AbortController().signal)
  assert.equal(result.ok, false)
  await assert.rejects(readFile(join(outside, 'note.txt')))
})

test('rolls back this batch when atomic publication fails after an earlier file', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'emate-file-import-rollback-'))
  await assert.rejects(importIntoWorkspace(workspace, [
    { bytes: Buffer.from('first'), displayName: 'first.txt', mediaType: 'text/plain', storedName: 'first.txt' },
    { bytes: Buffer.from('second'), displayName: 'second.txt', mediaType: 'text/plain', storedName: 'missing/second.txt' },
  ]))
  await assert.rejects(readFile(join(workspace, '.e-mate', 'imports', 'first.txt')))
})

test('keeps the client contract on target draft mentions and an explicit safe allowlist', async () => {
  assert.equal(allowedMediaType('report.pdf'), 'application/pdf')
  assert.equal(allowedMediaType('run.cmd'), undefined)
  assert.equal(appendImportedMentions('请阅读', [{ relative_path: '.e-mate/imports/report.pdf' }]), '请阅读 @.e-mate/imports/report.pdf ')
  const client = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
  assert.match(client, /ctx\.connection\.isLoopback/u)
  assert.match(client, /inputActions\.setDraft\(appendImportedMentions/u)
  assert.match(client, /data-emate-resource-path=\{row\.phase === 'ready' \? row\.relativePath : undefined\}/u)
  assert.match(client, /IconPaperclipOutline16/u)
  assert.doesNotMatch(client, />＋</u)
  assert.match(client, /name:\s*'conversation\.input\.left'/u)
  assert.match(client, /name:\s*'文件'/u)
  assert.match(client, /inputTriggers\.registerSource\(source\)/u)
  assert.match(client, /e-mate:file-picker-requested/u)
  assert.doesNotMatch(client, /new WebSocket|createStore|ctx\.router|fetch\(/u)
})
