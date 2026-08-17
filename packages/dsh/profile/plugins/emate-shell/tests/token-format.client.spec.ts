import { describe, expect, it } from 'vitest'
import { formatTokenCount } from '../src/client/token-format.ts'

describe('Token display', () => {
  it('keeps three digits exact and uses K/M above them', () => {
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1_000)).toBe('1K')
    expect(formatTokenCount(1_250)).toBe('1.3K')
    expect(formatTokenCount(1_000_000)).toBe('1M')
    expect(formatTokenCount(1_250_000)).toBe('1.3M')
  })
})
