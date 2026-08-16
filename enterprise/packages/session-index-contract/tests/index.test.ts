import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSessionSummaryDraft,
  parseSessionSummary,
  parseSessionSummarySearchResult,
  parseSessionSummarySearchIntent,
  parseSessionSummaryWrite,
} from '../src/index.ts';

const write = {
  schemaVersion: 1,
  title: '季度复盘',
  summary: '完成销售数据分析并生成汇报。',
  projectId: 'project-1',
  tags: ['销售', '汇报'],
  state: 'ACTIVE',
  updatedAt: '2026-07-26T10:00:00.000Z',
  expectedSourceCursor: null,
};

test('parses strict summary writes and search results', () => {
  assert.deepEqual(parseSessionSummaryWrite(write), write);
  const { expectedSourceCursor: _expected, ...draft } = write;
  assert.deepEqual(parseSessionSummaryDraft(draft), draft);
  assert.deepEqual(
    parseSessionSummarySearchIntent({
      query: '销售',
      projectId: 'project-1',
      includeArchived: true,
      limit: 20,
    }).query,
    '销售'
  );
  const summary = {
    ...write,
    sessionId: 'session-1',
    ownerId: 'user@example.com',
    sourceCursor: 1,
  };
  const { expectedSourceCursor: _cursor, ...stored } = summary;
  assert.deepEqual(parseSessionSummary(stored), stored);
  assert.deepEqual(
    parseSessionSummarySearchResult({
      schemaVersion: 1,
      sessions: [stored],
    }),
    { schemaVersion: 1, sessions: [stored] }
  );
});

test('rejects stale shapes, duplicate tags and deleted content', () => {
  assert.throws(() => parseSessionSummaryWrite({ ...write, tenantId: 'x' }));
  assert.throws(() =>
    parseSessionSummaryWrite({
      ...write,
      tags: ['重复', '重复'],
    })
  );
  assert.throws(() =>
    parseSessionSummaryWrite({
      ...write,
      updatedAt: 'not-a-date',
    })
  );
  assert.throws(() =>
    parseSessionSummaryWrite({
      ...write,
      state: 'DELETED',
    })
  );
  assert.throws(() =>
    parseSessionSummary({
      ...write,
      sessionId: 'session-1',
      ownerId: 'user\u0085control',
      sourceCursor: 1,
    })
  );
  assert.deepEqual(
    parseSessionSummaryWrite({
      ...write,
      title: '',
      summary: '',
      tags: [],
      state: 'DELETED',
    }).state,
    'DELETED'
  );
});
