import { describe, expect, it } from 'vitest'
import { desktopDefaultRelaunchArguments } from '../src/relaunch-arguments.ts'

describe('Desktop relaunch arguments', () => {
  it('preserves the entrypoint and explicit user-data directory', () => {
    expect(desktopDefaultRelaunchArguments([
      '/Applications/e-Mate.app/Contents/MacOS/e-Mate',
      'desktop-main.cjs',
      '--user-data-dir=/private/tmp/e-mate-user-data',
    ])).toEqual([
      'desktop-main.cjs',
      '--user-data-dir=/private/tmp/e-mate-user-data',
    ])
  })
})
