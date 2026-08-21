import assert from 'node:assert/strict'
import test from 'node:test'

import {
  adaptHarnessFsSource,
  adaptHarnessSessionPersistenceSource,
  adaptHarnessSessionSource,
} from './harness-runtime-adapters.mjs'

const rc7Seam = `\tasync resolvePolicy(toolName, args, exec) {
\t\tvalidateEscalationArgs(args.sandbox_permissions, args.justification);
\t\tconst standingPolicy = this.policy?.resolve({ ...exec.agent ? { session: exec.agent.session } : {} });
\t\tif (args.sandbox_permissions === void 0 || args.justification === void 0) return standingPolicy;`

const rc7SessionSeam = `\tappend(type, data, ...opts) {
\t\tconst surfaceOpts = opts[0];
\t\tconst surfaceMetadata = {
\t\t\t...surfaceOpts?.sourceEventSeqs === void 0 ? {} : { sourceEventSeqs: surfaceOpts.sourceEventSeqs },
\t\t\t...surfaceOpts?.surfaceOp === void 0 ? {} : { surfaceOp: surfaceOpts.surfaceOp }
\t\t};`

const rc7PersistenceSeam = `\t\t\tif (KNOWN_SESSION_EVENT_TYPES.has(event.type) || event.ignorable === true) continue;`

test('filesystem adapter ignores only escalation metadata redundant with the standing policy', () => {
  const adapted = adaptHarnessFsSource(rc7Seam)
  assert.match(adapted, /standingPolicy\.mode === "danger-full-access"/u)
  assert.match(adapted, /if \(!redundantEscalation\) validateEscalationArgs/u)
  assert.match(adapted, /args\.justification === void 0 \|\| redundantEscalation/u)
})

test('filesystem adapter fails closed when the pinned Harness seam drifts', () => {
  assert.throws(() => adaptHarnessFsSource('future harness output'), /expected one rc\.7 escalation seam, found 0/u)
})

test('session adapter persists only an explicit true ignorable marker', () => {
  const adapted = adaptHarnessSessionSource(rc7SessionSeam)
  assert.match(adapted, /surfaceOpts\?\.ignorable !== void 0 && surfaceOpts\.ignorable !== true/u)
  assert.match(adapted, /surfaceOpts\?\.ignorable === true \? \{ ignorable: true \} : \{\}/u)
})

test('session adapter fails closed when the pinned Harness append seam drifts', () => {
  assert.throws(() => adaptHarnessSessionSource('future harness output'), /expected one rc\.7 append seam, found 0/u)
})

test('session persistence adapter accepts only the legacy e-Mate image event', () => {
  const adapted = adaptHarnessSessionPersistenceSource(rc7PersistenceSeam)
  assert.match(adapted, /event\.type === "emate\/image-output"/u)
  assert.doesNotMatch(adapted, /future\/event/u)
})

test('session persistence adapter fails closed when the pinned event guard drifts', () => {
  assert.throws(() => adaptHarnessSessionPersistenceSource('future harness output'), /expected one rc\.7 event guard, found 0/u)
})
