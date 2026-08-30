import { describe, expect, it } from 'vitest'
import {
  DESKTOP_RESOURCE_BRIDGE,
  DESKTOP_RESOURCE_RUN,
  parseDesktopResourceRequest,
} from '../src/desktop-resource-bridge-contract.ts'

describe('desktop resource bridge contract', () => {
  it('admits only the exact channel, global and request shapes', () => {
    expect(DESKTOP_RESOURCE_BRIDGE).toBe('__EMATE_DESKTOP_RESOURCES__')
    expect(DESKTOP_RESOURCE_RUN).toBe('emate:desktop-resource-run')
    expect(parseDesktopResourceRequest({
      action: 'reveal',
      resource: { kind: 'file', sessionId: 's1', root: '/work', path: '/work/report.pdf' },
    })).toEqual({
      action: 'reveal',
      resource: { kind: 'file', sessionId: 's1', root: '/work', path: '/work/report.pdf' },
    })
    expect(parseDesktopResourceRequest({
      action: 'copy-image',
      resource: { kind: 'image', sessionId: 's1', name: 'result.png', src: 'blob:one' },
    })).toEqual({
      action: 'copy-image',
      resource: { kind: 'image', sessionId: 's1', name: 'result.png', src: 'blob:one' },
    })
  })

  it.each([
    { action: 'open', resource: { kind: 'file', sessionId: 's1', root: '/work', path: '/work/a' } },
    { action: 'reveal', extra: true, resource: { kind: 'file', sessionId: 's1', root: '/work', path: '/work/a' } },
    { action: 'reveal', resource: { kind: 'file', sessionId: '', root: '/work', path: '/work/a' } },
    { action: 'reveal', resource: { kind: 'file', sessionId: 's1', root: '/work', path: '/work/a', name: 'a' } },
    { action: 'copy-image', resource: { kind: 'file', sessionId: 's1', root: '/work', path: '/work/a' } },
    { action: 'copy-path', resource: { kind: 'image', sessionId: 's1', name: 'a', src: 'blob:a' } },
    { action: 'copy-image', resource: { kind: 'image', sessionId: 's1', name: 'a', src: 'https://example.com/a.png' } },
    { action: 'copy-image', resource: { kind: 'image', sessionId: 's1\0other', name: 'a', src: 'blob:a' } },
    { action: 'copy-image', resource: { kind: 'image', sessionId: 's1', name: '', src: 'blob:a' } },
  ])('rejects fields outside the exact allowlist: %#', value => {
    expect(parseDesktopResourceRequest(value)).toBeUndefined()
  })
})
