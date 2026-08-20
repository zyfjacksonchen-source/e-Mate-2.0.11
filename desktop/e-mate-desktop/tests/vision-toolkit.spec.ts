import { expect, it } from 'vitest'
import { bundledPythonPath } from '../src/vision-toolkit.ts'

it('exports only the architecture-matched Vision Python carrier', () => {
  expect(bundledPythonPath()).toMatch(new RegExp(`python-runtime/${process.platform}-${process.arch}/python/`))
})
