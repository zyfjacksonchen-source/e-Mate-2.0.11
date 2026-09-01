import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DESKTOP_INSTALLER_QUIT_FLAG } from '../src/desktop-installer-quit.ts'

const packageRoot = new URL('../', import.meta.url)
const workspaceRoot = new URL('../../', import.meta.url)

function source(path: string, root: URL = packageRoot): string {
  return readFileSync(new URL(path, root), 'utf8')
}

describe('Windows assisted NSIS handoff', () => {
  it('checks for the exact app before requesting orderly shutdown', () => {
    const script = source('build/installer.nsh')
    const firstDetection = script.indexOf('!insertmacro FIND_PROCESS')
    const request = script.indexOf(DESKTOP_INSTALLER_QUIT_FLAG)
    const wait = script.indexOf('emate_installer_wait_for_exit:')
    const fallback = script.indexOf('emate_installer_scoped_fallback:')

    expect(script).toContain('!macro customCheckAppRunning')
    expect(script).toContain('Var pid')
    expect(script).toContain('ExecWait')
    expect(script).toContain('$INSTDIR\\${APP_EXECUTABLE_FILENAME}')
    expect(script).toContain('!insertmacro IS_POWERSHELL_AVAILABLE')
    expect(firstDetection).toBeGreaterThanOrEqual(0)
    expect(request).toBeGreaterThan(firstDetection)
    expect(wait).toBeGreaterThan(request)
    expect(fallback).toBeGreaterThan(wait)
  })

  it('keeps useZip extraction on the one canonical install directory', () => {
    const workspaceRequire = createRequire(new URL('package.json', packageRoot))
    const appBuilderManifest = workspaceRequire.resolve('app-builder-lib/package.json')
    const templates = join(dirname(appBuilderManifest), 'templates', 'nsis')
    const extraction = readFileSync(join(templates, 'include', 'extractAppPackage.nsh'), 'utf8')
    const installSection = readFileSync(join(templates, 'installSection.nsh'), 'utf8')
    const patch = source('patches/app-builder-lib@26.15.3.patch', workspaceRoot)
    const manifest = JSON.parse(source('package.json')) as {
      scripts?: Record<string, string>
      build?: { nsis?: { useZip?: boolean } }
    }

    expect(manifest.build?.nsis?.useZip).toBe(true)
    expect(extraction).toContain('nsisunz::Unzip "$PLUGINSDIR\\app-$packageArch.zip" "$INSTDIR"')
    expect(installSection).toContain('SetOutPath $INSTDIR')
    expect(installSection).toContain('!insertmacro uninstallOldVersion SHELL_CONTEXT')
    expect(installSection.match(/!insertmacro installApplicationFiles/gu)).toHaveLength(1)
    expect(installSection.match(/!insertmacro addStartMenuLink \$keepShortcuts/gu)).toHaveLength(1)
    expect(installSection.match(/!insertmacro addDesktopLink \$keepShortcuts/gu)).toHaveLength(1)
    expect(installSection).not.toContain('customUpdateInstallShouldRun')
    expect(patch).toContain('ManifestLongPathAware true')
    expect(patch.match(/\[System\.IO\.Path\]::GetFileName\(\$\$_\.Path\) -ieq '\$\{_FILE\}'/gu))
      .toHaveLength(2)
    expect(patch).not.toContain('templates/nsis/installSection.nsh')
    expect(patch).not.toContain('extractUsing7za')
    expect(patch).not.toContain('handleUninstallResult')
  })

  it('removes the private transaction from every active Windows handoff owner', () => {
    const active = [
      source('src/electron-runtime.ts'),
      source('src/main.ts'),
      source('build/installer.nsh'),
      source('patches/app-builder-lib@26.15.3.patch', workspaceRoot),
      source('package.json'),
    ].join('\n')

    expect(active).not.toContain('customUpdateInstallShouldRun')
    expect(active).not.toContain('scheduleWindowsUpdateInstallation')
    expect(active).not.toContain('beginWindowsUpdateCandidateStartup')
    expect(active).not.toContain('completeWindowsUpdateCandidateStartup')
    expect(active).not.toContain('windows-update-transaction')
    expect(active).not.toContain('--emate-update-request')
    expect(active).not.toContain('--emate-update-token')
    expect(active).not.toMatch(/['"]\/S['"]/u)
  })
})
