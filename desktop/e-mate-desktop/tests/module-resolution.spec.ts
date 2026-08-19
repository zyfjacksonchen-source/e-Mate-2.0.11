import { describe, expect, it } from 'vitest'
import { isBaseProfileRuntimeSpecifier } from '../src/module-resolution.ts'

describe('hot Profile component runtime boundary', () => {
  it('exposes only the exact Base ABI imports declared by that component', () => {
    const imports = new Set(['@deepseek-ai/dsh-tools', 'react'])
    expect(isBaseProfileRuntimeSpecifier('@deepseek-ai/dsh-tools', imports)).toBe(true)
    expect(isBaseProfileRuntimeSpecifier('@deepseek-ai/dsh-tools/internal', imports)).toBe(true)
    expect(isBaseProfileRuntimeSpecifier('react/jsx-runtime', imports)).toBe(true)
    expect(isBaseProfileRuntimeSpecifier('@deepseek-ai/dsh-skill-filesystem', imports)).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('react-dom/client', imports)).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('@modelcontextprotocol/sdk/client/index.js', imports)).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('yaml', imports)).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('zod', imports)).toBe(false)
    expect(isBaseProfileRuntimeSpecifier('@e-mate/dsh-plugin-sibling', imports)).toBe(false)
  })
})
