/** Rebuild the current Electron command line for an ordinary relaunch. */
export function desktopDefaultRelaunchArguments(argv: readonly string[] = process.argv): string[] {
  return argv.slice(1)
}
