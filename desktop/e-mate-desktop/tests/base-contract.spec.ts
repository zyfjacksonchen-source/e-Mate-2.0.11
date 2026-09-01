import { describe, expect, it } from 'vitest'
import { parseProfileBaseContract } from '../src/base-contract.ts'

function contract(): Record<string, unknown> {
  return {
    schema_version: 1,
    id: 'e-mate-desktop-profile-v15-dsh-32728743c289',
    desktop_reference: {
      repository: 'anywhere-labs/deepseek-harness-desktop',
      commit: '6074088f5b660206e404b3591fab51fb99c69add',
      harness_repository: 'deepseek-ai/deepseek-harness',
      harness_commit: '99f6f02fecdb7dff40c3fbc9470f5907c29f74ca',
      harness_version: '0.1.0-rc.7',
    },
    harness_version: '0.1.0-rc.7',
    harness_commit: '32728743c28911bcd4279f79fe9c43ee7aacfb6d',
    runtime_imports: {
      '@deepseek-ai/dsh-client-runtime': '0.1.0-rc.7',
      '@deepseek-ai/dsh-settings': '0.1.0-rc.7',
      react: '18.3.1',
    },
  }
}

describe('Desktop Base contract', () => {
  it('accepts the exact pinned contract shape', () => {
    expect(parseProfileBaseContract(contract())).toMatchObject({
      schema_version: 1,
      harness_version: '0.1.0-rc.7',
      harness_commit: '32728743c28911bcd4279f79fe9c43ee7aacfb6d',
    })
  })

  it('rejects extra fields and rc drift', () => {
    expect(parseProfileBaseContract({ ...contract(), extra: true })).toBeUndefined()
    expect(parseProfileBaseContract({ ...contract(), harness_version: '0.1.0-rc.8' })).toBeUndefined()
  })
})
