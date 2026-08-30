import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const testRoot = dirname(fileURLToPath(import.meta.url))
const capabilitiesCss = readFileSync(resolve(testRoot, '../src/client/capabilities.module.css'), 'utf8')
const desktopFrame = readFileSync(resolve(testRoot, '../../../desktop/e-mate-desktop/src/client/AdvancedFrame.tsx'), 'utf8')

test('root overlay starts at its Desktop-owned live sidebar edge', () => {
  assert.match(desktopFrame, /['"]--dsh-desktop-sidebar-width['"]:\s*`\$\{columns\.sidebar\}px`/u)
  assert.match(capabilitiesCss, /\.page\s*\{[\s\S]*?inset-inline-start:\s*var\(--dsh-desktop-sidebar-width,\s*0px\)/u)
  assert.match(capabilitiesCss, /@media \(max-width: 767px\) \{[\s\S]*?\.page\s*\{[\s\S]*?inset-inline-start:\s*0/u)
})
