import assert from 'node:assert/strict';
import test from 'node:test';
import { issuedWeeklyTokenLimit } from '../src/postgres-store.ts';

test('null tenant quota is issued as an effective unlimited session allowance', () => {
  assert.equal(issuedWeeklyTokenLimit(null), Number.MAX_SAFE_INTEGER);
  assert.equal(issuedWeeklyTokenLimit('5000000'), 5_000_000);
  assert.equal(issuedWeeklyTokenLimit('0'), null);
  assert.equal(issuedWeeklyTokenLimit(String(Number.MAX_SAFE_INTEGER + 1)), null);
});
