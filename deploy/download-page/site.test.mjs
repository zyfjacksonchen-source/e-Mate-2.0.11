import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isMacDesktop,
  normalizeVersionIndex,
  parseVersionIndexText,
  targetFromPlatformSignals,
} from './site.js'

test('download page uses the fixed Desktop version and platform endpoints', () => {
  const index = parseVersionIndexText('{"version":"2.0.16"}')
  assert.deepEqual(index.downloads.map(({ target, url }) => ({ target, url })), [
    {
      target: 'macos-universal',
      url: 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/downloads/mac',
    },
    {
      target: 'windows-x64',
      url: 'https://pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev/desktop/downloads/windows',
    },
  ])
  assert.throws(() => normalizeVersionIndex({ version: '2.0.16', signature: 'legacy' }))
  assert.equal(targetFromPlatformSignals('MacIntel'), 'macos-universal')
  assert.equal(targetFromPlatformSignals('Win32'), 'windows-x64')
  assert.equal(isMacDesktop('iPhone Mac OS'), false)
})
