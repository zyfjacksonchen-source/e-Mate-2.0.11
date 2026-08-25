/** Electron-backed Windows adapter for the native DSH directory-picker seam. */

import type { Context } from '@deepseek-ai/cordis'
import {
  DirectoryPicker,
  type DirectoryPickerCapability,
} from '@deepseek-ai/dsh-host-directory-picker'
import type {} from './runtime.ts'

/** Native picker provider used only by the Windows desktop profile. */
export class DesktopWindowsDirectoryPicker extends DirectoryPicker {
  static inject = ['desktopRuntime']

  private readonly nativeCapability: DirectoryPickerCapability = {
    kind: 'native',
    pick: async signal => {
      let rejectAbort!: (reason?: unknown) => void
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = reject
      })
      const onAbort = () => { rejectAbort(signal.reason) }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        signal.throwIfAborted()
        // ponytail: Electron cannot dismiss showOpenDialog; abort releases this
        // caller while the runtime single-flights the panel until it closes.
        const pick = this.ctx.desktopRuntime.pickDirectory()
        return await Promise.race([pick, aborted])
      } finally {
        signal.removeEventListener('abort', onAbort)
      }
    },
  }

  constructor(ctx: Context) {
    super(ctx)
    if (ctx.desktopRuntime.platform !== 'win32') {
      throw new Error('@e-mate/desktop: Windows directory picker requires a win32 desktop runtime')
    }
  }

  /** @inheritdoc */
  capability(): DirectoryPickerCapability {
    return this.nativeCapability
  }
}

export default DesktopWindowsDirectoryPicker
