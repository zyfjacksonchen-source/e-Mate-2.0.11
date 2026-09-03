import assert from 'node:assert/strict'
import { link, lstat, mkdtemp, mkdir, readFile, readdir, realpath, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import test from 'node:test'
import { apply, importIntoWorkspace } from '../src/index.ts'
import { ALLOWED_MEDIA_BY_EXTENSION, appendImportedMentions, CHANNEL, fileDropRoute, MAX_FILE_BYTES, MAX_FILES, MAX_TOTAL_BYTES } from '../src/contract.ts'

async function mounted(workspace, archivedSessionIds = []) {
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
    workspaceRegistry: { archivedSessionIds, list: () => [{ path: workspace, sessionIds: ['session-1'] }] },
  })
  return { handler, options }
}

const encoded = (name, bytes = Buffer.from('content'), mediaType = 'application/octet-stream') => ({
  name, media_type: mediaType, bytes_base64: bytes.toString('base64'),
})
const invoke = (handler, files, sessionId = 'session-1') => handler(
  'import', { session_id: sessionId, files }, new AbortController().signal,
)

test('imports every allowlisted ordinary extension through one canonical host path', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'emate-file-import-types-'))
  const { handler, options } = await mounted(workspace)
  assert.deepEqual(options, { authority: 'loopback' })
  for (const [extension, canonicalMedia] of Object.entries(ALLOWED_MEDIA_BY_EXTENSION)) {
    const bytes = Buffer.from([0, extension.length, 255])
    const result = await invoke(handler, [encoded(`样例.${extension}`, bytes, 'application/x-spoofed')])
    assert.equal(result.ok, true, extension)
    const [file] = result.value.files
    assert.equal(file.media_type, canonicalMedia, extension)
    assert.equal(file.display_name, `样例.${extension}`)
    assert.match(file.stored_name, /^[^/@\s]+$/u)
    assert.deepEqual(await readFile(join(workspace, file.relative_path)), bytes)
    const mention = appendImportedMentions('', [file])
    assert.equal((mention.match(/@\.e-mate\/imports\//gu) ?? []).length, 1, extension)
  }
})

test('normalizes decomposed Unicode names to NFC and keeps safe collision names', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'emate-file-import-nfc-'))
  const { handler } = await mounted(workspace)
  const decomposed = '中文e\u0301 报告@终稿.txt'
  const first = await invoke(handler, [encoded(decomposed)])
  assert.equal(first.ok, true)
  assert.equal(first.value.files[0].display_name, decomposed.normalize('NFC'))
  assert.equal(first.value.files[0].stored_name, '中文é_报告_终稿.txt')
  const second = await invoke(handler, [encoded(decomposed)])
  assert.equal(second.value.files[0].stored_name, '中文é_报告_终稿-2.txt')
  assert.ok(Buffer.byteLength(second.value.files[0].stored_name) <= 160)
})

test('supports zero bytes and exact file, total, and count boundaries', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'emate-file-import-limits-'))
  const { handler } = await mounted(workspace)
  const zero = await invoke(handler, [encoded('empty.txt', Buffer.alloc(0))])
  assert.equal(zero.ok, true)
  assert.equal(zero.value.files[0].bytes, 0)
  assert.deepEqual(await readFile(join(workspace, zero.value.files[0].relative_path)), Buffer.alloc(0))

  const exactFile = await invoke(handler, [encoded('exact.bin.txt', Buffer.alloc(MAX_FILE_BYTES))])
  assert.equal(exactFile.ok, true)
  const overFile = await invoke(handler, [encoded('over.txt', Buffer.alloc(MAX_FILE_BYTES + 1))])
  assert.equal(overFile.ok, false)

  const exactCount = await invoke(handler, Array.from({ length: MAX_FILES }, (_, i) => encoded(`count-${i}.txt`, Buffer.alloc(0))))
  assert.equal(exactCount.ok, true)
  const overCount = await invoke(handler, Array.from({ length: MAX_FILES + 1 }, (_, i) => encoded(`over-count-${i}.txt`, Buffer.alloc(0))))
  assert.equal(overCount.ok, false)

  const part = MAX_TOTAL_BYTES / MAX_FILES
  const exactTotal = await invoke(handler, Array.from({ length: MAX_FILES }, (_, i) => encoded(`total-${i}.txt`, Buffer.alloc(part))))
  assert.equal(exactTotal.ok, true)
  const overTotal = await invoke(handler, Array.from({ length: MAX_FILES }, (_, i) => encoded(`over-total-${i}.txt`, Buffer.alloc(part + (i === 0 ? 1 : 0)))))
  assert.equal(overTotal.ok, false)
})

test('rejects malformed or noncanonical base64, unknown and executable extensions', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'emate-file-import-invalid-'))
  const { handler } = await mounted(workspace)
  for (const bytes_base64 of ['**', 'YQ', 'YR==', 'YQ==\n']) {
    const result = await invoke(handler, [{ ...encoded('note.txt'), bytes_base64 }])
    assert.equal(result.ok, false, bytes_base64)
    assert.equal(result.error.code, 'bad-request')
    assert.ok(Array.isArray(result.error.details.issues))
  }
  for (const name of ['unknown.bin', 'run.sh', 'setup.exe', 'install.pkg', 'macro.ps1', 'script.js', '.hidden.txt', 'CON.txt']) {
    assert.equal((await invoke(handler, [encoded(name)])).ok, false, name)
  }
})

test('binds imports to live session workspace membership', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'emate-file-import-session-'))
  const active = await mounted(workspace)
  assert.equal((await invoke(active.handler, [encoded('note.txt')], 'missing')).ok, false)
  const archived = await mounted(workspace, ['session-1'])
  assert.equal((await invoke(archived.handler, [encoded('note.txt')])).ok, false)
})

test('returns pinned internal RpcResult and logs only bounded diagnostics for unexpected host failures', async () => {
  const missingWorkspace = join(tmpdir(), 'emate-file-import-does-not-exist')
  const { handler } = await mounted(missingWorkspace)
  const calls = []
  const original = console.error
  console.error = (...args) => { calls.push(args) }
  try {
    assert.deepEqual(await invoke(handler, [encoded('note.txt')]), {
      ok: false, error: { code: 'internal', message: '文件暂时无法导入当前工作区。', details: {} },
    })
  } finally {
    console.error = original
  }
  assert.deepEqual(calls, [['[emate-file-import] internal import failure', { name: 'Error', code: 'ENOENT' }]])
  assert.doesNotMatch(JSON.stringify(calls), /does-not-exist|note\.txt|bytes_base64|stack/u)
})

test('captured handler results satisfy the pinned rc.7 server response schema when its runtime is available', async t => {
  let serverResponseSchema
  try {
    ({ serverResponseSchema } = await import('../../../upstream/deepseek-harness/packages/host/apiproxy/src/api/rpc.schema.ts'))
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND') return t.skip('pinned zod runtime is not installed in this source-only worktree')
    throw error
  }
  const workspace = await mkdtemp(join(tmpdir(), 'emate-file-import-rpc-'))
  const { handler } = await mounted(workspace)
  const results = [
    await invoke(handler, [encoded('ok.pdf')]),
    await invoke(handler, [encoded('bad.exe')]),
    { ok: false, error: { code: 'internal', message: '文件暂时无法导入当前工作区。', details: {} } },
  ]
  for (const result of results) serverResponseSchema.parse({ type: 'server-response', rpcId: 'captured', result })
  assert.throws(() => serverResponseSchema.parse({
    type: 'server-response', rpcId: 'old', result: { ok: false, error: { code: 'unavailable', message: 'x', details: {} } },
  }))
})

test('rejects a symlinked managed directory', { skip: process.platform === 'win32' }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'emate-file-import-link-'))
  const outside = await mkdtemp(join(tmpdir(), 'emate-file-import-outside-'))
  await mkdir(join(workspace, '.e-mate'))
  await symlink(outside, join(workspace, '.e-mate', 'imports'))
  const { handler } = await mounted(workspace)
  assert.equal((await invoke(handler, [encoded('note.txt')])).ok, false)
  await assert.rejects(readFile(join(outside, 'note.txt')))
})

test('removes a successful hard link when abort arrives after verification', async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'emate-file-import-post-link-abort-')))
  const controller = new AbortController()
  const operations = {
    link,
    async lstat(path) {
      const info = await lstat(path)
      controller.abort(new Error('post-link abort'))
      return info
    },
    unlink,
  }
  await assert.rejects(importIntoWorkspace(workspace, [
    { bytes: Buffer.from('secret'), displayName: 'abort.txt', mediaType: 'text/plain', storedName: 'abort.txt' },
  ], controller.signal, operations), /post-link abort/u)
  assert.deepEqual(await readdir(join(workspace, '.e-mate', 'imports')), [])
})

test('removes a successful hard link when target verification fails', async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'emate-file-import-post-link-verify-')))
  const verification = Object.assign(new Error('verification failed'), { code: 'EIO' })
  await assert.rejects(importIntoWorkspace(workspace, [
    { bytes: Buffer.from('secret'), displayName: 'verify.txt', mediaType: 'text/plain', storedName: 'verify.txt' },
  ], undefined, { link, lstat: async () => { throw verification }, unlink }), verification)
  assert.deepEqual(await readdir(join(workspace, '.e-mate', 'imports')), [])
})

test('surfaces target, temporary, and batch rollback cleanup failures', async () => {
  const targetWorkspace = await realpath(await mkdtemp(join(tmpdir(), 'emate-file-import-target-cleanup-')))
  const targetCleanup = Object.assign(new Error('target cleanup failed'), { code: 'EACCES' })
  await assert.rejects(importIntoWorkspace(targetWorkspace, [
    { bytes: Buffer.from('secret'), displayName: 'target.txt', mediaType: 'text/plain', storedName: 'target.txt' },
  ], undefined, {
    link,
    lstat: async () => { throw Object.assign(new Error('verification failed'), { code: 'EIO' }) },
    unlink: async path => {
      if (!path.includes('.import-')) throw targetCleanup
      await unlink(path)
    },
  }), error => error instanceof AggregateError && error.errors.includes(targetCleanup))
  await unlink(join(targetWorkspace, '.e-mate', 'imports', 'target.txt'))

  const temporaryWorkspace = await realpath(await mkdtemp(join(tmpdir(), 'emate-file-import-temp-cleanup-')))
  const temporaryCleanup = Object.assign(new Error('temporary cleanup failed'), { code: 'EACCES' })
  await assert.rejects(importIntoWorkspace(temporaryWorkspace, [
    { bytes: Buffer.from('secret'), displayName: 'temporary.txt', mediaType: 'text/plain', storedName: 'temporary.txt' },
  ], undefined, {
    link,
    lstat,
    unlink: async path => {
      if (path.includes('.import-')) throw temporaryCleanup
      await unlink(path)
    },
  }), temporaryCleanup)
  for (const name of await readdir(join(temporaryWorkspace, '.e-mate', 'imports'))) await unlink(join(temporaryWorkspace, '.e-mate', 'imports', name))

  const batchWorkspace = await realpath(await mkdtemp(join(tmpdir(), 'emate-file-import-batch-cleanup-')))
  const batchCleanup = Object.assign(new Error('batch cleanup failed'), { code: 'EACCES' })
  await assert.rejects(importIntoWorkspace(batchWorkspace, [
    { bytes: Buffer.from('first'), displayName: 'first.txt', mediaType: 'text/plain', storedName: 'first.txt' },
    { bytes: Buffer.from('second'), displayName: 'second.txt', mediaType: 'text/plain', storedName: 'missing/second.txt' },
  ], undefined, {
    link,
    lstat,
    unlink: async path => {
      if (basename(path) === 'first.txt') throw batchCleanup
      await unlink(path)
    },
  }), error => error instanceof AggregateError && error.errors.includes(batchCleanup))
  await unlink(join(batchWorkspace, '.e-mate', 'imports', 'first.txt'))
})

test('rolls back the whole batch when a later atomic publication fails', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'emate-file-import-rollback-'))
  await assert.rejects(importIntoWorkspace(await realpath(workspace), [
    { bytes: Buffer.from('first'), displayName: 'first.txt', mediaType: 'text/plain', storedName: 'first.txt' },
    { bytes: Buffer.from('second'), displayName: 'second.txt', mediaType: 'text/plain', storedName: 'missing/second.txt' },
  ]))
  assert.deepEqual(await readdir(join(workspace, '.e-mate', 'imports')), [])
})

test('routes folders through native Workspace and mixed composer files through native image plus ordinary paths', () => {
  assert.equal(fileDropRoute({ composerTarget: true, directory: true, normalizeImage: false, ordinary: true, workspaceTarget: false }), 'pass')
  assert.equal(fileDropRoute({ composerTarget: false, directory: true, normalizeImage: false, ordinary: true, workspaceTarget: true }), 'pass')
  assert.equal(fileDropRoute({ composerTarget: false, directory: false, normalizeImage: false, ordinary: true, workspaceTarget: false }), 'pass')
  assert.equal(fileDropRoute({ composerTarget: true, directory: false, normalizeImage: true, ordinary: true, workspaceTarget: false }), 'intake-all')
  assert.equal(fileDropRoute({ composerTarget: false, directory: false, normalizeImage: true, ordinary: true, workspaceTarget: false }), 'normalize-images')
})
