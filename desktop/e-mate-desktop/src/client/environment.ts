/** Desktop renderer modes accepted from the Electron-owned page URL. */
export type DesktopClientMode = 'compatibility' | 'advanced'

/** Host platforms whose native chrome has a desktop presentation. */
export type DesktopClientPlatform = 'darwin' | 'win32' | 'linux'

/** Validated renderer environment supplied by the Electron Host. */
export interface DesktopClientEnvironment {
  /** Active shell mode for this BrowserWindow lifetime. */
  mode: DesktopClientMode
  /** Electron Host platform used for native spacing and drag regions. */
  platform: DesktopClientPlatform
}

const MODES = new Set<DesktopClientMode>(['compatibility', 'advanced'])
const PLATFORMS = new Set<DesktopClientPlatform>(['darwin', 'win32', 'linux'])
const SESSION_KEY = '@e-mate/desktop:environment-v1'

type EnvironmentStorage = Pick<Storage, 'getItem' | 'setItem'>

/**
 * Validate the Electron-owned query marker before any desktop client effects run.
 * @param search - URL search string, including or omitting the leading question mark.
 * @returns the validated desktop renderer environment.
 */
export function parseDesktopClientEnvironment(
  search: string,
  storage?: EnvironmentStorage,
): DesktopClientEnvironment {
  const current = new URLSearchParams(search)
  const source = !current.has('dsh-desktop-mode') && !current.has('dsh-desktop-platform')
    ? storage?.getItem(SESSION_KEY) ?? search
    : search
  const params = new URLSearchParams(source)
  const mode = params.get('dsh-desktop-mode')
  const platform = params.get('dsh-desktop-platform')
  if (!MODES.has(mode as DesktopClientMode)) {
    throw new Error(`@e-mate/desktop: invalid or missing dsh-desktop-mode ${JSON.stringify(mode)}`)
  }
  if (!PLATFORMS.has(platform as DesktopClientPlatform)) {
    throw new Error(`@e-mate/desktop: invalid or missing dsh-desktop-platform ${JSON.stringify(platform)}`)
  }
  const environment = { mode: mode as DesktopClientMode, platform: platform as DesktopClientPlatform }
  storage?.setItem(SESSION_KEY, new URLSearchParams({
    'dsh-desktop-mode': environment.mode,
    'dsh-desktop-platform': environment.platform,
  }).toString())
  return environment
}
