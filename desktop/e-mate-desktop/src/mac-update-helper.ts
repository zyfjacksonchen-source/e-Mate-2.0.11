/** Standalone Electron-as-Node entry for the detached macOS replacement. */

import { runMacUpdateHelper } from './mac-update-installer.ts'

const requestPath = process.argv[2]
if (requestPath === undefined) {
  process.stderr.write('@e-mate/desktop: macOS update helper needs one request path\n')
  process.exitCode = 1
} else {
  void runMacUpdateHelper(requestPath).catch((cause: unknown) => {
    process.stderr.write(`@e-mate/desktop: macOS update helper failed: ${cause instanceof Error ? cause.message : String(cause)}\n`)
    process.exitCode = 1
  })
}
