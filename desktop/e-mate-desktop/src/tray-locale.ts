/** Desktop-owned native tray copy for the locales shipped by e-Mate. */

import type { DesktopLocale } from './runtime.ts'

export type DesktopTrayLabelKey =
  | 'checkForUpdates'
  | 'checkingForUpdates'
  | 'downloadingUpdate'
  | 'updateAvailable'

const labels: Record<DesktopLocale, Record<DesktopTrayLabelKey, (value: string) => string>> = {
  en: {
    checkForUpdates: () => 'Check for Updates…',
    checkingForUpdates: () => 'Checking for Updates…',
    downloadingUpdate: version => `Downloading e-Mate ${version}…`,
    updateAvailable: version => `e-Mate ${version} Available`,
  },
  zh: {
    checkForUpdates: () => '检查更新…',
    checkingForUpdates: () => '正在检查更新…',
    downloadingUpdate: version => `正在下载 e-Mate ${version}…`,
    updateAvailable: version => `e-Mate ${version} 可用`,
  },
}

/** Resolve one native tray label without Renderer dependencies. */
export function desktopTrayLabel(locale: DesktopLocale, key: DesktopTrayLabelKey, value = ''): string {
  return labels[locale][key](value)
}
