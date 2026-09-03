import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { createXlsxWorkbook } from '../src/xlsx-export.ts';

test('creates a real XLSX archive with readable, literal audit cells', () => {
  const archive = unzipSync(createXlsxWorkbook('审计/明细', [
    ['发生时间', '用户', '任务'],
    ['2026-09-03T01:02:03.000Z', '张三 & 李四', '=HYPERLINK("bad")'],
  ]));
  assert.deepEqual(Object.keys(archive).sort(), [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/workbook.xml',
    'xl/worksheets/sheet1.xml',
  ]);
  const workbook = strFromU8(archive['xl/workbook.xml']);
  const worksheet = strFromU8(archive['xl/worksheets/sheet1.xml']);
  assert.match(workbook, /sheet name="审计 明细"/);
  assert.match(worksheet, /<pane ySplit="1"/);
  assert.match(worksheet, /<autoFilter ref="A1:C2"/);
  assert.match(worksheet, /张三 &amp; 李四/);
  assert.match(worksheet, /=HYPERLINK\("bad"\)/);
  assert.doesNotMatch(worksheet, /<f>/);
});

test('rejects an empty workbook instead of writing a mislabeled file', () => {
  assert.throws(() => createXlsxWorkbook('audit', []), /at least one column/);
});
