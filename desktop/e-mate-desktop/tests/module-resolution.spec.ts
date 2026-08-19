import { describe, expect, it } from 'vitest'
import { isBaseProfileRuntimeSpecifier } from '../src/module-resolution.ts'

describe('hot Profile component runtime boundary', () => {
  it('exposes only the pinned DSH and React Base ABI', () => {
    expect(isBaseProfileRuntimeSpecifier('@deepseek-ai/dsh-tools')).toBe(true)
    expect(isBaseProfileRuntimeSpecifier('@deepseek-ai/dsh-skill-filesystem/internal')).toBe(true)
    expect(isBaseProfileRuntimeSpecifier('react/jsx-runtime')).toBe(true)
    expect(isBaseProfileRuntimeSpecifier('react-dom/client')).toBe(true)
    expect(isBaseProfileRuntimeSpecifier('@modelcontextprotocol/sdk/client/index.js')).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('yaml')).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('zod')).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('@e-mate/dsh-plugin-sibling')).toBe(false)
  })
})
