import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const packageRoot = new URL('../', import.meta.url)
const workspaceRoot = new URL('../../', import.meta.url)

function source(path: string, root: URL = packageRoot): string {
  return readFileSync(new URL(path, root), 'utf8')
}

describe('pinned assisted-NSIS atomic update seam', () => {
  it('binds candidate bytes before startup and ACKs only after Renderer health with the packaged Base floor', () => {
    const main = source('src/main.ts')
    const begin = main.indexOf('await beginWindowsUpdateCandidateStartup')
    const rendererHealth = main.indexOf("if (rendererReport.status === 'failed')")
    const complete = main.indexOf('await completeWindowsUpdateCandidateStartup')
    expect(begin).toBeGreaterThan(main.indexOf('app.requestSingleInstanceLock()'))
    expect(begin).toBeLessThan(main.indexOf('const baseContract = loadProfileBaseContract'))
    expect(complete).toBeGreaterThan(rendererHealth)
    expect(main.slice(complete, main.indexOf('markDesktopProfileHealthy', complete)))
      .toContain('scheduleProtocolFloor: baseContract.schedule_protocol_floor')
  })

  it('enters the custom seam only for a complete private transaction before any old-version mutation', () => {
    const patch = source('patches/app-builder-lib@26.15.3.patch', workspaceRoot)
    const installed = source('node_modules/app-builder-lib/templates/nsis/installSection.nsh')
    const seam = installed.indexOf('!insertmacro customUpdateInstall\n')
    expect(patch).toContain('!ifmacrodef customUpdateInstallShouldRun')
    expect(installed.slice(installed.indexOf('!ifmacrodef customUpdateInstallShouldRun'), seam))
      .toContain('$R7 == "true"')
    expect(installed.slice(installed.indexOf('!ifmacrodef customUpdateInstallShouldRun'), seam))
      .not.toContain('${isUpdated}')
    expect(seam).toBeGreaterThan(installed.indexOf('!insertmacro setLinkVars'))
    expect(seam).toBeLessThan(installed.indexOf('!insertmacro CHECK_APP_RUNNING'))
    expect(seam).toBeLessThan(installed.indexOf('!insertmacro uninstallOldVersion SHELL_CONTEXT'))
  })

  it('leaves fresh/manual install and builder-owned uninstaller generation on the upstream path', () => {
    const installed = source('node_modules/app-builder-lib/templates/nsis/installSection.nsh')
    const include = source('build/installer.nsh')
    expect(installed).toContain('!insertmacro uninstallOldVersion SHELL_CONTEXT')
    expect(installed).toContain('!insertmacro installApplicationFiles')
    expect(installed).toContain('!ifmacrodef customInstall')
    expect(include).toContain('!ifndef BUILD_UNINSTALLER')
    expect(include).toContain('StrCpy ${OUT_VAR} "false"')
    expect(include).toContain('$emateUpdateRequest != ""')
    expect(include).toContain('$emateUpdateToken != ""')
    expect(include).toContain('The private e-Mate update request is incomplete.')
    expect(include).toContain('!macro customUpdateInstall')
    expect(include).not.toContain('!macro customUnInstallSection')
    expect(() => source('build/installer.nsi')).toThrow()
  })

  it('stages before READY and journals both forward renames plus both rollback renames', () => {
    const coordinator = source('build/windows-update-transaction.ps1')
    const phases = [
      'staging',
      'staged',
      'ready',
      'canonical-to-last-good-pending',
      'canonical-at-last-good',
      'candidate-to-canonical-pending',
      'candidate-at-canonical',
      'awaiting-ack',
      'confirmation-pending',
      'confirmed',
      'applied',
      'rollback-candidate-pending',
      'candidate-at-failed',
      'rollback-last-good-pending',
      'rolled-back',
    ]
    for (const phase of phases) expect(coordinator).toContain(`'${phase}'`)
    expect(coordinator).toContain('Move-DirectoryDurable $Journal.canonicalDirectory $Journal.lastGoodDirectory')
    expect(coordinator).toContain('Move-DirectoryDurable $Journal.candidateDirectory $Journal.canonicalDirectory')
    expect(coordinator).toContain('Move-DirectoryDurable $Journal.canonicalDirectory $Journal.failedDirectory')
    expect(coordinator).toContain('Move-DirectoryDurable $Journal.lastGoodDirectory $Journal.canonicalDirectory')
    expect(coordinator).toContain("$flags = $flags -bor 1")
    expect(coordinator).toContain('[EmateUpdateNative]::MoveFileEx($Path, $removed, 8)')
  })

  it('injects failure at every irreversible rename boundary in the native self-test', () => {
    const coordinator = source('build/windows-update-transaction.ps1')
    for (const boundary of [
      'canonical-to-last-good-pending', 'canonical-at-last-good',
      'candidate-to-canonical-pending', 'candidate-at-canonical',
      'rollback-candidate-pending', 'candidate-at-failed',
      'rollback-last-good-pending', 'rolled-back',
    ]) {
      expect(coordinator.slice(coordinator.indexOf('function Invoke-SelfTest'))).toContain(`'${boundary}'`)
    }
    expect(coordinator).toContain('Assert-OldCanonical $tree')
    expect(coordinator).toContain('Assert-NewCanonical $success')
    expect(coordinator).toContain('Invoke-Rollback $rollbackTree.journal')
    expect(coordinator).toContain('Assert-OldCanonical $rollbackTree')
  })

  it('can recover after canonical stops being the old Base and aborts safely before shutdown authority', () => {
    const coordinator = source('build/windows-update-transaction.ps1')
    const prepare = coordinator.slice(coordinator.indexOf('function Invoke-Prepare'), coordinator.indexOf('function Assert-Candidate'))
    expect(prepare.indexOf('Assert-InstallerContext $request')).toBeLessThan(prepare.indexOf('if (Test-Path -LiteralPath $journalPath)'))
    expect(prepare.lastIndexOf('Assert-OriginalCurrent $request')).toBeGreaterThan(prepare.indexOf('if (Test-Path -LiteralPath $journalPath)'))
    expect(coordinator).toContain('Wait-ShutdownWhileParentLives $request')
    expect(coordinator).toContain('Invoke-StagedRollback $journal $request')
    expect(coordinator).toContain('Assert-LastGood $Journal')
    expect(coordinator).toContain('Remove-RealDirectoryIfPresent $Journal.failedDirectory')
    expect(coordinator).toContain("yyyy-MM-dd'T'HH:mm:ss.fff'Z'")
    expect(coordinator).not.toContain("ToString('o')")
  })

  it('keeps confirmation/APPLIED forward-only and limits rollback to unconfirmed phases', () => {
    const coordinator = source('build/windows-update-transaction.ps1')
    const rollbackGuard = /if \(@\(([^\r\n]+)\) -contains \$Journal\.phase\) \{/u.exec(coordinator)?.[1]
    expect(rollbackGuard).toBe("'candidate-at-canonical', 'awaiting-ack', 'confirmation-pending'")
    expect(coordinator).toContain("Set-Phase $journal 'confirmed-unknown'")
    expect(coordinator).toContain("Write-ResultIni 'forward-only' $journal")
    expect(coordinator).toContain("if ($Journal.phase -ceq 'rolled-back' -and -not $script:SelfTesting)")
    expect(coordinator).toContain('$script:Request.currentExecutableSha256 $script:Request.currentVersion')
  })

  it('isolates physical directories and recovery ownership by transaction id', () => {
    const coordinator = source('build/windows-update-transaction.ps1')
    const runtime = source('src/windows-update-installer.ts')
    expect(runtime).toContain("`.${APP_ID}-update`, transactionId")
    expect(coordinator).toContain('"e-MateUpdateRecovery-$($Request.transactionId)"')
    expect(coordinator).toContain('"Registry::HKEY_USERS\\$($Request.ownerSid)\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce"')
    expect(coordinator).toContain("if ($InstallMode -ceq 'all') { '/allusers' } else { '/currentuser' }")
    const register = coordinator.slice(coordinator.indexOf('function Register-Recovery'), coordinator.indexOf('function Remove-Recovery'))
    expect(register).toContain("if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null }")
    expect(register.indexOf('New-Item -Path $key')).toBeLessThan(register.indexOf('New-ItemProperty -LiteralPath $key'))
    expect(coordinator.slice(coordinator.indexOf('function Invoke-SelfTest')))
      .toContain('missing-key recovery registration failed')
    expect(coordinator).toContain("Join-Path (Split-Path -Parent $Request.transactionRoot) 'active.json'")
    expect(coordinator).toContain('Assert-Lease (Read-BoundedJson $path) $Request')
    expect(coordinator).toContain('Remove-OwnPending $Request')
    expect(coordinator).toContain('Remove-FileDurable $Request.pendingPath')
    expect(coordinator).not.toContain("-Name 'e-MateUpdateRecovery' -Force")
    expect(coordinator).toContain("[ValidateSet('CurrentUser', 'all')]")
    expect(coordinator).toContain('[EmateUpdateNative]::RegFlushKey($key.Handle)')
    expect(coordinator).toContain('function Test-ProcessPath([int]$ProcessId')
    expect(coordinator).toContain("if ($Journal.phase -cne 'rolled-back') { Stop-ExactCandidate $Journal }")
    expect(coordinator).toContain("'another transaction was modified'")
    expect(coordinator).toContain("'a second transaction acquired another owner lease'")
  })
})
