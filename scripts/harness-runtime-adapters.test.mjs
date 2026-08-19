import assert from 'node:assert/strict'
import test from 'node:test'

import { adaptHarnessFsSource } from './harness-runtime-adapters.mjs'

const rc7Seam = `\tasync resolvePolicy(toolName, args, exec) {
\t\tvalidateEscalationArgs(args.sandbox_permissions, args.justification);
\t\tconst standingPolicy = this.policy?.resolve({ ...exec.agent ? { session: exec.agent.session } : {} });
\t\tif (args.sandbox_permissions === void 0 || args.justification === void 0) return standingPolicy;`

test('filesystem adapter ignores only escalation metadata redundant with the standing policy', () => {
  const adapted = adaptHarnessFsSource(rc7Seam)
  assert.match(adapted, /standingPolicy\.mode === "danger-full-access"/u)
  assert.match(adapted, /if \(!redundantEscalation\) validateEscalationArgs/u)
  assert.match(adapted, /args\.justification === void 0 \|\| redundantEscalation/u)
})

test('filesystem adapter fails closed when the pinned Harness seam drifts', () => {
  assert.throws(() => adaptHarnessFsSource('future harness output'), /expected one rc\.7 escalation seam, found 0/u)
})
