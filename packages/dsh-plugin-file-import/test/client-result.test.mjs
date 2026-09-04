import assert from 'node:assert/strict'
import test from 'node:test'
import { parseImageStageResult, parseImportResult, SAFE_IMPORT_ERROR_MESSAGE, safeThrownImportMessage } from '../src/client/result.ts'

const validation = message => ({ ok: false, error: { code: 'bad-request', message, details: { issues: [] } } })

test('shows only allowlisted bounded business validation messages', () => {
  assert.deepEqual(parseImportResult(validation('不支持此文件类型。')), { ok: false, message: '不支持此文件类型。' })
  for (const result of [
    validation('任意 Host 消息 /Users/alice/private.xlsx'),
    { ok: false, error: { code: 'bad-request', message: '不支持此文件类型。', details: { issues: [{ code: 'custom' }] } } },
    { ok: false, error: { code: 'internal', message: 'raw stack', details: {} } },
    { ok: false, error: { code: 'unavailable', message: 'old raw error', details: {} } },
    { ok: false, error: { code: 'bad-request', message: '不支持此文件类型。', details: { issues: [], path: '/tmp/a' } } },
  ]) assert.deepEqual(parseImportResult(result), { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE })
})

test('strictly accepts canonical success and rejects malformed response fields', () => {
  const file = { bytes: 0, display_name: '报告.xlsx', media_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', relative_path: '.e-mate/imports/报告.xlsx', stored_name: '报告.xlsx' }
  assert.deepEqual(parseImportResult({ ok: true, value: { schema_version: 1, files: [file] } }), { ok: true, files: [file] })
  const success = entry => ({ ok: true, value: { schema_version: 1, files: [entry] } })
  const stored = name => success({ ...file, stored_name: name, relative_path: '.e-mate/imports/' + name })
  for (const value of [
    success({ ...file, media_type: 'application/octet-stream' }),
    success({ ...file, relative_path: '/Users/alice/report.xlsx' }),
    success({ ...file, display_name: 'e\u0301.xlsx' }),
    success({ ...file, display_name: '.hidden.xlsx' }),
    success({ ...file, display_name: 'CON.xlsx' }),
    success({ ...file, display_name: 'report?.xlsx' }),
    success({ ...file, display_name: 'a'.repeat(157) + '.txt', media_type: 'text/plain' }),
    stored('.hidden.xlsx'),
    stored('CON.xlsx'),
    stored('report .xlsx'),
    stored('report?.xlsx'),
    stored('report.exe'),
    stored('a'.repeat(157) + '.txt'),
    { ok: true, value: { schema_version: 1, files: [file], issues: [] } },
    { ok: true, value: { schema_version: 1, files: [] } },
  ]) assert.deepEqual(parseImportResult(value), { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE })
})

test('rejects duplicate stored names and relative paths before mentions are appended', () => {
  const file = { bytes: 0, display_name: '报告.txt', media_type: 'text/plain', relative_path: '.e-mate/imports/报告.txt', stored_name: '报告.txt' }
  assert.deepEqual(parseImportResult({ ok: true, value: { schema_version: 1, files: [file, file] } }), {
    ok: false, message: SAFE_IMPORT_ERROR_MESSAGE,
  })
})

test('strictly parses staged image refs without accepting bytes, paths, or malformed metadata', () => {
  const ref = { attachmentId: `sha256:${'a'.repeat(64)}`, mediaType: 'image/png', bytes: 1, width: 1, height: 1, name: '像素.png' }
  const success = attachment => ({ ok: true, value: { schema_version: 1, attachments: [attachment] } })
  assert.deepEqual(parseImageStageResult(success(ref)), { ok: true, attachments: [ref] })
  assert.deepEqual(parseImageStageResult({ ok: true, value: { schema_version: 1, attachments: [ref, ref] } }), { ok: true, attachments: [ref, ref] })
  const exact = { ...ref, bytes: 5 * 1024 * 1024 }
  const twenty = Array.from({ length: 20 }, () => exact)
  assert.deepEqual(parseImageStageResult({ ok: true, value: { schema_version: 1, attachments: twenty } }), { ok: true, attachments: twenty })
  assert.deepEqual(parseImageStageResult({ ok: true, value: { schema_version: 1, attachments: [...twenty, exact] } }), { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE })
  for (const value of [
    success({ ...ref, attachmentId: 'native-runtime-id' }), success({ ...ref, bytes: 0 }), success({ ...ref, bytes: 5 * 1024 * 1024 + 1 }),
    success({ ...ref, mediaType: 'image/svg+xml' }), success({ ...ref, width: 1.5 }), success({ ...ref, width: 10_000, height: 4_001 }), success({ ...ref, name: '../private.png' }),
    success({ ...ref, name: '.' }), success({ ...ref, name: 'e\u0301.png' }), success({ ...ref, name: `${'界'.repeat(84)}.png` }),
    success({ ...ref, bytes_base64: 'AQ==' }), { ok: true, value: { schema_version: 1, attachments: [ref], path: '/tmp/a' } },
  ]) assert.deepEqual(parseImageStageResult(value), { ok: false, message: SAFE_IMPORT_ERROR_MESSAGE })
  assert.deepEqual(parseImageStageResult(validation('图片暂存数据无效。')), { ok: false, message: '图片暂存数据无效。' })
  assert.deepEqual(parseImageStageResult(validation('图片尺寸超过当前限制。')), { ok: false, message: '图片尺寸超过当前限制。' })
})

test('maps transport and thrown Zod-like invalid_union values to fixed safe copy', () => {
  const zodLike = Object.assign(new Error('[{ code: invalid_union, path: /Users/alice/report.xlsx }]'), {
    name: 'ZodError', issues: [{ code: 'invalid_union', path: ['/Users/alice/report.xlsx'] }],
  })
  for (const error of [zodLike, new Error('HTTP 500 raw host stack'), 'arbitrary failure', null]) {
    assert.equal(safeThrownImportMessage(error), SAFE_IMPORT_ERROR_MESSAGE)
  }
})
