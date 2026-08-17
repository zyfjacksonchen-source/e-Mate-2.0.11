import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { normalizedAbsolute } from '../src/client/resource-context.ts'

describe('desktop resource context', () => {
  it('keeps relative products inside the current workspace and wires only real DOM resources', () => {
    expect(normalizedAbsolute('/workspace', 'reports/季度报告.docx'))
      .toBe('/workspace/reports/季度报告.docx')
    expect(normalizedAbsolute('/workspace', '../../outside.txt')).toBeUndefined()
    expect(normalizedAbsolute('C:\\workspace', 'reports\\季度报告.docx'))
      .toBe('C:/workspace/reports/季度报告.docx')

    const source = readFileSync(new URL('../src/client/resource-context.ts', import.meta.url), 'utf8')
    expect(source).toContain("document.addEventListener('contextmenu', onContextMenu, true)")
    expect(source).toContain("'[data-produced-files-row] button[title]'")
    expect(source).toContain("'[data-emate-resource-path]'")
    expect(source).toContain("image.src.startsWith('blob:')")
    expect(source).toContain('Reflect.set(globalThis, RESOURCE_KEY')
  })
})
