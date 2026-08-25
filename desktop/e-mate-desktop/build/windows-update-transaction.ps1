param(
  [ValidateSet('Prepare', 'Apply', 'Monitor', 'SelfTest')]
  [string]$Operation,
  [string]$RequestPath,
  [string]$Token,
  [string]$InstallerPath,
  [string]$InstallDirectory,
  [ValidateSet('CurrentUser', 'all')]
  [string]$InstallMode = 'CurrentUser',
  [string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$script:AppId = 'net.ecoremedia.e-mate'
$script:ProductExecutable = 'e-Mate.exe'
$script:MaxJsonBytes = 65536
$script:PollMilliseconds = 100
$script:ReadyTimeoutSeconds = 120
$script:StartupTimeoutSeconds = 120
$script:FailAfterPhase = $null
$script:SelfTesting = $false
$script:RecoveryKeyOverride = $null

Add-Type -TypeDefinition @'
using System;
using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
public static class EmateUpdateNative {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool MoveFileEx(string existingName, string newName, int flags);

  [DllImport("advapi32.dll")]
  public static extern int RegFlushKey(SafeRegistryHandle key);
}
'@

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Get-UtcIsoTimestamp {
  return [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture)
}

function Get-FullPath([string]$Path) {
  return [IO.Path]::GetFullPath($Path).TrimEnd('\')
}

function Test-SamePath([string]$Left, [string]$Right) {
  return [StringComparer]::OrdinalIgnoreCase.Equals((Get-FullPath $Left), (Get-FullPath $Right))
}

function Assert-RealFile([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  Assert-True (-not $item.PSIsContainer) "not a file: $Path"
  Assert-True (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) "reparse-point file rejected: $Path"
  return $item
}

function Assert-RealDirectory([string]$Path) {
  $item = Get-Item -LiteralPath $Path -Force
  Assert-True $item.PSIsContainer "not a directory: $Path"
  Assert-True (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) "reparse-point directory rejected: $Path"
  return $item
}

function Assert-ExactProperties($Value, [string[]]$Names) {
  $actual = @($Value.PSObject.Properties.Name)
  Assert-True ($actual.Count -eq $Names.Count) 'unexpected JSON properties'
  foreach ($name in $Names) { Assert-True ($actual -ccontains $name) "missing JSON property: $name" }
}

function Read-BoundedJson([string]$Path) {
  $item = Assert-RealFile $Path
  Assert-True ($item.Length -gt 0 -and $item.Length -le $script:MaxJsonBytes) "unbounded JSON: $Path"
  $bytes = [IO.File]::ReadAllBytes($item.FullName)
  $utf8 = [Text.UTF8Encoding]::new($false, $true)
  return ($utf8.GetString($bytes) | ConvertFrom-Json)
}

function Write-DurableJson([string]$Path, $Value, [switch]$Exclusive) {
  $parent = Split-Path -Parent $Path
  Assert-RealDirectory $parent | Out-Null
  if ($Exclusive -and (Test-Path -LiteralPath $Path)) { throw "durable file already exists: $Path" }
  $temporary = Join-Path $parent ('.' + [IO.Path]::GetFileName($Path) + '.' + [Guid]::NewGuid().ToString('D') + '.tmp')
  $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Value | ConvertTo-Json -Depth 12 -Compress) + "`n")
  $stream = [IO.FileStream]::new(
    $temporary,
    [IO.FileMode]::CreateNew,
    [IO.FileAccess]::Write,
    [IO.FileShare]::None,
    4096,
    [IO.FileOptions]::WriteThrough
  )
  try {
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush($true)
  } finally {
    $stream.Dispose()
  }
  $flags = 8
  if (-not $Exclusive) { $flags = $flags -bor 1 }
  if ($script:SelfTesting -and [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    [IO.File]::Move($temporary, $Path, (-not $Exclusive))
    return
  }
  if (-not [EmateUpdateNative]::MoveFileEx($temporary, $Path, $flags)) {
    $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    throw "durable rename failed ($errorCode): $Path"
  }
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Move-DirectoryDurable([string]$From, [string]$To) {
  Assert-RealDirectory $From | Out-Null
  Assert-True (-not (Test-Path -LiteralPath $To)) "rename destination exists: $To"
  Assert-True ([StringComparer]::OrdinalIgnoreCase.Equals(
    [IO.Path]::GetPathRoot((Get-FullPath $From)),
    [IO.Path]::GetPathRoot((Get-FullPath $To))
  )) 'cross-volume directory rename rejected'
  if ($script:SelfTesting -and [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    [IO.Directory]::Move($From, $To)
    return
  }
  if (-not [EmateUpdateNative]::MoveFileEx($From, $To, 8)) {
    $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "directory rename failed ($errorCode): $From -> $To"
  }
}

function Remove-FileDurable([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  Assert-RealFile $Path | Out-Null
  $removed = Join-Path (Split-Path -Parent $Path) ('.' + [IO.Path]::GetFileName($Path) + '.removed.' + [Guid]::NewGuid().ToString('D'))
  if ($script:SelfTesting -and [Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    [IO.File]::Move($Path, $removed)
  } elseif (-not [EmateUpdateNative]::MoveFileEx($Path, $removed, 8)) {
    $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    throw "durable file removal rename failed ($errorCode): $Path"
  }
  Remove-Item -LiteralPath $removed -Force -ErrorAction SilentlyContinue
}

function Get-IdentityProperties {
  return @(
    'transactionId', 'token', 'targetVersion', 'sourceCommit', 'baseContractId',
    'scheduleProtocolFloor', 'manifestIdentity', 'artifact', 'canonicalDirectory', 'transactionRoot'
  )
}

function Assert-Artifact($Actual, $Expected) {
  Assert-ExactProperties $Actual @('url', 'bytes', 'sha256')
  Assert-True ($Actual.url -is [string]) 'artifact URL rejected'
  Assert-True (($Actual.bytes -is [int] -or $Actual.bytes -is [long]) -and [int64]$Actual.bytes -gt 0) 'artifact size rejected'
  Assert-True ($Actual.sha256 -is [string] -and $Actual.sha256 -cmatch '^[0-9a-f]{64}$') 'artifact hash rejected'
  Assert-True ($Actual.url -ceq $Expected.url) 'artifact URL mismatch'
  Assert-True ([int64]$Actual.bytes -eq [int64]$Expected.bytes) 'artifact size mismatch'
  Assert-True ($Actual.sha256 -ceq $Expected.sha256) 'artifact hash mismatch'
}

function Assert-CommitIdentity($Document, $Request) {
  Assert-True ($Document.transactionId -ceq $Request.transactionId) 'transaction mismatch'
  Assert-True ($Document.token -ceq $Request.token) 'token mismatch'
  Assert-True ($Document.targetVersion -ceq $Request.targetVersion) 'target version mismatch'
  Assert-True ($Document.sourceCommit -ceq $Request.sourceCommit) 'source commit mismatch'
  Assert-True ($Document.baseContractId -ceq $Request.baseContractId) 'Base contract mismatch'
  Assert-True ([int]$Document.scheduleProtocolFloor -eq [int]$Request.scheduleProtocolFloor) 'Schedule floor mismatch'
  Assert-True ($Document.manifestIdentity -ceq $Request.manifestIdentity) 'manifest identity mismatch'
  Assert-Artifact $Document.artifact $Request.artifact
  Assert-True (Test-SamePath $Document.canonicalDirectory $Request.canonicalDirectory) 'canonical path mismatch'
  Assert-True (Test-SamePath $Document.transactionRoot $Request.transactionRoot) 'transaction root mismatch'
}

function Assert-MailboxAcl([string]$MailboxPath, [string]$OwnerSid) {
  $acl = Get-Acl -LiteralPath $MailboxPath
  Assert-True $acl.AreAccessRulesProtected 'update mailbox inherits ACLs'
  $allowed = @($OwnerSid, 'S-1-5-18', 'S-1-5-32-544')
  $sawOwner = $false
  foreach ($rule in $acl.Access) {
    Assert-True (-not $rule.IsInherited) 'inherited mailbox rule rejected'
    $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    Assert-True ($allowed -contains $sid) "unexpected mailbox principal: $sid"
    Assert-True ($rule.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow) 'mailbox deny rule rejected'
    if ($sid -eq $OwnerSid) { $sawOwner = $true }
  }
  Assert-True $sawOwner 'mailbox owner rule missing'
}

function Read-Request {
  Assert-True ($Token -match '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') 'invalid private update token'
  $request = Read-BoundedJson $RequestPath
  Assert-ExactProperties $request @(
    'schemaVersion', 'documentType', 'appId', 'transactionId', 'token', 'parentPid',
    'ownerSid', 'currentVersion', 'targetVersion', 'sourceCommit', 'baseContractId',
    'scheduleProtocolFloor', 'manifestIdentity', 'artifact', 'installerPath',
    'currentExecutable', 'currentExecutableSha256', 'canonicalDirectory', 'transactionRoot',
    'mailboxPath', 'pendingPath', 'createdAt'
  )
  Assert-True ($request.schemaVersion -eq 1 -and $request.documentType -ceq 'emate.windows-update-request') 'request type rejected'
  Assert-True ($request.appId -ceq $script:AppId) 'application identity rejected'
  Assert-True ($request.transactionId -match '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') 'transaction id rejected'
  Assert-True ($request.token -match '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') 'request token shape rejected'
  Assert-True ($request.token -ceq $Token) 'private update token rejected'
  Assert-True (($request.parentPid -is [int] -or $request.parentPid -is [long]) -and [int64]$request.parentPid -gt 1 -and [int64]$request.parentPid -le [int]::MaxValue) 'parent PID rejected'
  Assert-True ($request.ownerSid -match '^S-1-(?:[0-9]+-){1,14}[0-9]+$') 'owner SID rejected'
  Assert-True ($request.currentVersion -is [string] -and $request.currentVersion -cmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') 'current version rejected'
  Assert-True ($request.targetVersion -is [string] -and $request.targetVersion -cmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') 'target version rejected'
  try {
    Assert-True ([version]$request.targetVersion -gt [version]$request.currentVersion) 'target version is not newer'
  } catch { throw 'request version range rejected' }
  Assert-True ($request.sourceCommit -match '^[0-9a-f]{40}$') 'source commit rejected'
  Assert-True ($request.baseContractId -match '^[A-Za-z0-9._-]{1,200}$') 'Base contract rejected'
  Assert-True (($request.scheduleProtocolFloor -is [int] -or $request.scheduleProtocolFloor -is [long]) -and [int64]$request.scheduleProtocolFloor -gt 0 -and [int64]$request.scheduleProtocolFloor -le [int]::MaxValue) 'Schedule floor rejected'
  Assert-True ($request.manifestIdentity -match '^[0-9a-f]{64}$') 'manifest identity rejected'
  Assert-True ($request.currentExecutableSha256 -match '^[0-9a-f]{64}$') 'current executable hash rejected'
  foreach ($name in @('installerPath', 'currentExecutable', 'canonicalDirectory', 'transactionRoot', 'mailboxPath', 'pendingPath')) {
    Assert-True ($request.$name -is [string] -and $request.$name.Length -gt 0 -and $request.$name -notmatch '[\x00\r\n]') "request path rejected: $name"
  }
  Assert-Artifact $request.artifact $request.artifact
  $mailbox = Get-FullPath (Split-Path -Parent $RequestPath)
  Assert-True (Test-SamePath $RequestPath (Join-Path $mailbox 'request.json')) 'request path escaped mailbox'
  Assert-True (Test-SamePath $request.mailboxPath $mailbox) 'mailbox path mismatch'
  Assert-True (Test-SamePath $request.pendingPath (Join-Path (Split-Path -Parent $mailbox) 'pending.json')) 'pending path mismatch'
  $canonical = Get-FullPath $request.canonicalDirectory
  $container = Join-Path (Split-Path -Parent $canonical) ".$script:AppId-update"
  $root = Get-FullPath $request.transactionRoot
  Assert-True (Test-SamePath $root (Join-Path $container $request.transactionId)) 'transaction root is not transaction-scoped'
  Assert-True ([StringComparer]::OrdinalIgnoreCase.Equals(
    [IO.Path]::GetPathRoot($root), [IO.Path]::GetPathRoot($canonical)
  )) 'transaction root is not same-volume'
  Assert-True (Test-SamePath $request.currentExecutable (Join-Path $canonical $script:ProductExecutable)) 'current executable path mismatch'
  $artifactUri = [Uri]$request.artifact.url
  Assert-True ($artifactUri.Scheme -ceq 'https' -and $artifactUri.Host -ceq 'pub-ada3f610c0234a76838f4e19fe2bb25e.r2.dev') 'artifact origin rejected'
  Assert-True ($artifactUri.Query.Length -eq 0 -and $artifactUri.Fragment.Length -eq 0) 'artifact URL suffix rejected'
  Assert-True ($artifactUri.AbsolutePath -cmatch ('^/desktop/releases/v' + [Regex]::Escape($request.targetVersion) + '/' + [Regex]::Escape($request.sourceCommit) + '/[^/]+\.exe$')) 'artifact release identity mismatch'
  $created = [DateTimeOffset]::MinValue
  Assert-True ($request.createdAt -is [string] -and $request.createdAt -cmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' -and [DateTimeOffset]::TryParse($request.createdAt, [ref]$created)) 'request timestamp rejected'
  Assert-MailboxAcl $mailbox $request.ownerSid
  return $request
}

function Assert-InstallerContext($Request) {
  $installer = Assert-RealFile $InstallerPath
  Assert-True (Test-SamePath $installer.FullName $Request.installerPath) 'Setup path mismatch'
  Assert-True ($installer.Length -eq [int64]$Request.artifact.bytes) 'Setup size mismatch'
  Assert-True ((Get-Sha256 $installer.FullName) -ceq $Request.artifact.sha256) 'Setup hash mismatch'
  Assert-True (Test-SamePath $InstallDirectory $Request.canonicalDirectory) 'NSIS install directory mismatch'
}

function Assert-OriginalCurrent($Request) {
  $current = Assert-RealFile $Request.currentExecutable
  Assert-True ((Get-Sha256 $current.FullName) -ceq $Request.currentExecutableSha256) 'current executable hash mismatch'
  $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($current.FullName).ProductVersion
  Assert-True ($version -ceq $Request.currentVersion) 'current executable version mismatch'
}

function Assert-ExecutableIdentity([string]$Path, [string]$Hash, [string]$Version) {
  if ($script:SelfTesting) { return }
  $file = Assert-RealFile $Path
  Assert-True ((Get-Sha256 $file.FullName) -ceq $Hash) 'transaction executable hash mismatch'
  $actualVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($file.FullName).ProductVersion
  Assert-True ($actualVersion -ceq $Version) 'transaction executable version mismatch'
}

function New-Journal($Request) {
  $root = Get-FullPath $Request.transactionRoot
  $candidate = Join-Path $root 'candidate'
  return [ordered]@{
    schemaVersion = 1
    documentType = 'emate.windows-update-journal'
    phase = 'staging'
    transactionId = $Request.transactionId
    token = $Request.token
    currentVersion = $Request.currentVersion
    targetVersion = $Request.targetVersion
    sourceCommit = $Request.sourceCommit
    baseContractId = $Request.baseContractId
    scheduleProtocolFloor = [int]$Request.scheduleProtocolFloor
    manifestIdentity = $Request.manifestIdentity
    artifact = $Request.artifact
    installMode = $InstallMode
    canonicalDirectory = (Get-FullPath $Request.canonicalDirectory)
    transactionRoot = $root
    candidateDirectory = $candidate
    lastGoodDirectory = (Join-Path $root 'last-good')
    failedDirectory = (Join-Path $root 'failed')
    candidateExecutable = (Join-Path $candidate $script:ProductExecutable)
    candidateExecutableSha256 = $null
    updatedAt = Get-UtcIsoTimestamp
  }
}

function Assert-JournalIdentity($Journal, $Request) {
  Assert-ExactProperties $Journal @(
    'schemaVersion', 'documentType', 'phase', 'transactionId', 'token', 'currentVersion',
    'targetVersion', 'sourceCommit', 'baseContractId', 'scheduleProtocolFloor',
    'manifestIdentity', 'artifact', 'installMode', 'canonicalDirectory', 'transactionRoot',
    'candidateDirectory', 'lastGoodDirectory', 'failedDirectory', 'candidateExecutable',
    'candidateExecutableSha256', 'updatedAt'
  )
  Assert-True ($Journal.schemaVersion -eq 1 -and $Journal.documentType -ceq 'emate.windows-update-journal') 'journal type rejected'
  Assert-True ($Journal.transactionId -ceq $Request.transactionId -and $Journal.token -ceq $Request.token) 'journal owner rejected'
  Assert-True ($Journal.currentVersion -ceq $Request.currentVersion -and $Journal.targetVersion -ceq $Request.targetVersion) 'journal version rejected'
  Assert-True ($Journal.sourceCommit -ceq $Request.sourceCommit -and $Journal.baseContractId -ceq $Request.baseContractId) 'journal identity rejected'
  Assert-True ([int]$Journal.scheduleProtocolFloor -eq [int]$Request.scheduleProtocolFloor) 'journal Schedule floor rejected'
  Assert-True ($Journal.manifestIdentity -ceq $Request.manifestIdentity) 'journal manifest rejected'
  Assert-Artifact $Journal.artifact $Request.artifact
  Assert-True ($Journal.installMode -ceq $InstallMode) 'journal install mode rejected'
  Assert-True (Test-SamePath $Journal.canonicalDirectory $Request.canonicalDirectory) 'journal canonical path rejected'
  Assert-True (Test-SamePath $Journal.transactionRoot $Request.transactionRoot) 'journal root rejected'
  Assert-True (Test-SamePath $Journal.candidateDirectory (Join-Path $Request.transactionRoot 'candidate')) 'journal candidate path rejected'
  Assert-True (Test-SamePath $Journal.lastGoodDirectory (Join-Path $Request.transactionRoot 'last-good')) 'journal last-good path rejected'
  Assert-True (Test-SamePath $Journal.failedDirectory (Join-Path $Request.transactionRoot 'failed')) 'journal failed path rejected'
  Assert-True (Test-SamePath $Journal.candidateExecutable (Join-Path $Journal.candidateDirectory $script:ProductExecutable)) 'journal candidate executable rejected'
  Assert-True (@(
    'staging', 'staged', 'ready', 'canonical-to-last-good-pending', 'canonical-at-last-good',
    'candidate-to-canonical-pending', 'candidate-at-canonical', 'awaiting-ack',
    'confirmation-pending', 'confirmed', 'confirmed-unknown', 'applied', 'completed',
    'rollback-candidate-pending', 'candidate-at-failed', 'rollback-last-good-pending', 'rolled-back'
  ) -contains $Journal.phase) 'journal phase rejected'
  if ($Journal.phase -ceq 'staging') {
    Assert-True ($null -eq $Journal.candidateExecutableSha256) 'staging candidate hash rejected'
  } else {
    Assert-True ($Journal.candidateExecutableSha256 -is [string] -and $Journal.candidateExecutableSha256 -cmatch '^[0-9a-f]{64}$') 'candidate hash rejected'
  }
  $updated = [DateTimeOffset]::MinValue
  Assert-True ($Journal.updatedAt -is [string] -and $Journal.updatedAt -cmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' -and [DateTimeOffset]::TryParse($Journal.updatedAt, [ref]$updated)) 'journal timestamp rejected'
}

function Write-Journal($Journal) {
  $Journal.updatedAt = Get-UtcIsoTimestamp
  Write-DurableJson (Join-Path $Journal.transactionRoot 'journal.json') $Journal
}

function Set-Phase($Journal, [string]$Phase) {
  $Journal.phase = $Phase
  Write-Journal $Journal
  if ($script:FailAfterPhase -ceq $Phase) { throw "injected failure after $Phase" }
}

function Write-ResultIni([string]$Action, $Journal) {
  $content = @(
    '[update]'
    "action=$Action"
    "candidate=$($Journal.candidateDirectory)"
    "canonical=$($Journal.canonicalDirectory)"
    "phase=$($Journal.phase)"
  ) -join "`r`n"
  [IO.File]::WriteAllText($OutputPath, $content + "`r`n", [Text.UTF8Encoding]::new($false))
}

function Ensure-TransactionDirectories($Request) {
  $container = Split-Path -Parent $Request.transactionRoot
  if (-not (Test-Path -LiteralPath $container)) {
    [IO.Directory]::CreateDirectory($container) | Out-Null
  }
  Assert-RealDirectory $container | Out-Null
  if (-not (Test-Path -LiteralPath $Request.transactionRoot)) {
    [IO.Directory]::CreateDirectory($Request.transactionRoot) | Out-Null
  }
  Assert-RealDirectory $Request.transactionRoot | Out-Null
}

function Get-RecoveryKey($Request) {
  if ($null -ne $script:RecoveryKeyOverride) { return $script:RecoveryKeyOverride }
  return "Registry::HKEY_USERS\$($Request.ownerSid)\Software\Microsoft\Windows\CurrentVersion\RunOnce"
}

function Get-RecoveryName($Request) {
  return "e-MateUpdateRecovery-$($Request.transactionId)"
}

function Get-RecoveryCommand($Request) {
  $mode = if ($InstallMode -ceq 'all') { '/allusers' } else { '/currentuser' }
  return '"' + $Request.installerPath + '" /S ' + $mode + ' --updated --force-run --emate-update-request="' +
    $RequestPath + '" --emate-update-token=' + $Request.token + ' --emate-update-recover=1'
}

function Flush-RecoveryKey([string]$Path) {
  $key = Get-Item -LiteralPath $Path
  try {
    Assert-True ([EmateUpdateNative]::RegFlushKey($key.Handle) -eq 0) 'recovery registry flush failed'
  } finally {
    $key.Close()
  }
}

function Register-Recovery($Request) {
  $key = Get-RecoveryKey $Request
  $name = Get-RecoveryName $Request
  $command = Get-RecoveryCommand $Request
  if (-not (Test-Path -LiteralPath $key)) { New-Item -Path $key -Force | Out-Null }
  New-ItemProperty -LiteralPath $key -Name $name -Value $command -PropertyType String -Force | Out-Null
  Flush-RecoveryKey $key
}

function Remove-Recovery($Request) {
  $key = Get-RecoveryKey $Request
  $name = Get-RecoveryName $Request
  $existing = Get-ItemPropertyValue -LiteralPath $key -Name $name -ErrorAction SilentlyContinue
  if ($null -eq $existing) { return }
  Assert-True ($existing -ceq (Get-RecoveryCommand $Request)) 'recovery command owner mismatch'
  Remove-ItemProperty -LiteralPath $key -Name $name -Force
  Flush-RecoveryKey $key
}

function Get-LeasePath($Request) {
  return Join-Path (Split-Path -Parent $Request.transactionRoot) 'active.json'
}

function Assert-Lease($Lease, $Request) {
  Assert-ExactProperties $Lease @('schemaVersion', 'documentType', 'transactionId', 'token', 'requestPath')
  Assert-True ($Lease.schemaVersion -eq 1 -and $Lease.documentType -ceq 'emate.windows-update-lease') 'transaction lease type rejected'
  Assert-True ($Lease.transactionId -ceq $Request.transactionId -and $Lease.token -ceq $Request.token) 'another physical transaction owns the install'
  Assert-True (Test-SamePath $Lease.requestPath $RequestPath) 'transaction lease request mismatch'
}

function Acquire-TransactionLease($Request) {
  $path = Get-LeasePath $Request
  if (Test-Path -LiteralPath $path) {
    Assert-Lease (Read-BoundedJson $path) $Request
    return
  }
  Write-DurableJson $path ([ordered]@{
    schemaVersion = 1
    documentType = 'emate.windows-update-lease'
    transactionId = $Request.transactionId
    token = $Request.token
    requestPath = $RequestPath
  }) -Exclusive
}

function Release-TransactionLease($Request) {
  $path = Get-LeasePath $Request
  if (-not (Test-Path -LiteralPath $path)) { return }
  Assert-Lease (Read-BoundedJson $path) $Request
  Remove-FileDurable $path
}

function Remove-OwnPending($Request) {
  if (-not (Test-Path -LiteralPath $Request.pendingPath)) { return }
  $pending = Read-BoundedJson $Request.pendingPath
  Assert-ExactProperties $pending @('schemaVersion', 'requestPath', 'transactionId', 'token')
  Assert-True ($pending.schemaVersion -eq 1 -and $pending.transactionId -ceq $Request.transactionId -and $pending.token -ceq $Request.token) 'pending owner mismatch'
  Assert-True (Test-SamePath $pending.requestPath $RequestPath) 'pending request mismatch'
  Remove-FileDurable $Request.pendingPath
}

function Finalize-Transaction($Request) {
  Release-TransactionLease $Request
  Remove-OwnPending $Request
  Remove-Recovery $Request
}

function Test-ProcessPath([int]$ProcessId, [string]$ExpectedPath) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $false }
  Assert-True (Test-SamePath $process.ExecutablePath $ExpectedPath) 'PID identity mismatch'
  return $true
}

function Wait-ParentExit($Request) {
  $deadline = [DateTime]::UtcNow.AddSeconds($script:ReadyTimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (-not (Test-ProcessPath ([int]$Request.parentPid) $Request.currentExecutable)) { return }
    Start-Sleep -Milliseconds $script:PollMilliseconds
  }
  throw 'timed out waiting for the current Base to exit'
}

function Wait-ShutdownWhileParentLives($Request) {
  $path = Join-Path $Request.mailboxPath 'shutdown.json'
  $deadline = [DateTime]::UtcNow.AddSeconds($script:ReadyTimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $path) {
      return Wait-Document $path 'emate.windows-update-shutdown' $Request 1
    }
    if (-not (Test-ProcessPath ([int]$Request.parentPid) $Request.currentExecutable)) { return $null }
    Start-Sleep -Milliseconds $script:PollMilliseconds
  }
  throw 'timed out waiting for the current Base shutdown receipt'
}

function Wait-Document([string]$Path, [string]$Type, $Request, [int]$TimeoutSeconds) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (Test-Path -LiteralPath $Path) {
      $document = Read-BoundedJson $Path
      $extra = switch ($Type) {
        'emate.windows-update-shutdown' { @('parentPid') }
        'emate.windows-update-started' { @('pid', 'executable', 'executableSha256', 'startedAt') }
        'emate.windows-update-ack' { @('pid', 'executableSha256', 'acknowledgedAt') }
        'emate.windows-update-applied' { @('pid', 'executableSha256', 'appliedAt') }
        default { throw "unsupported transaction document: $Type" }
      }
      Assert-ExactProperties $document (@('schemaVersion', 'documentType') + (Get-IdentityProperties) + $extra)
      Assert-True ($document.schemaVersion -eq 1 -and $document.documentType -ceq $Type) "wrong document type: $Path"
      Assert-CommitIdentity $document $Request
      return $document
    }
    Start-Sleep -Milliseconds $script:PollMilliseconds
  }
  throw "timed out waiting for $Type"
}

function Write-Ready($Request) {
  $path = Join-Path $Request.mailboxPath 'ready.json'
  if (Test-Path -LiteralPath $path) {
    $existing = Read-BoundedJson $path
    Assert-ExactProperties $existing (@('schemaVersion', 'documentType') + (Get-IdentityProperties) + @('setupPid'))
    Assert-True ($existing.schemaVersion -eq 1 -and $existing.documentType -ceq 'emate.windows-update-ready') 'READY type rejected'
    Assert-CommitIdentity $existing $Request
    Assert-True ([int]$existing.setupPid -gt 1) 'READY PID rejected'
    return
  }
  Write-DurableJson $path ([ordered]@{
    schemaVersion = 1
    documentType = 'emate.windows-update-ready'
    transactionId = $Request.transactionId
    token = $Request.token
    targetVersion = $Request.targetVersion
    sourceCommit = $Request.sourceCommit
    baseContractId = $Request.baseContractId
    scheduleProtocolFloor = [int]$Request.scheduleProtocolFloor
    manifestIdentity = $Request.manifestIdentity
    artifact = $Request.artifact
    canonicalDirectory = $Request.canonicalDirectory
    transactionRoot = $Request.transactionRoot
    setupPid = $PID
  }) -Exclusive
}

function Invoke-Swap($Journal) {
  if ($Journal.phase -ceq 'staged' -or $Journal.phase -ceq 'ready') {
    Assert-RealDirectory $Journal.canonicalDirectory | Out-Null
    if (-not $script:SelfTesting) {
      Assert-ExecutableIdentity (Join-Path $Journal.canonicalDirectory $script:ProductExecutable) $script:Request.currentExecutableSha256 $script:Request.currentVersion
    }
    Assert-RealDirectory $Journal.candidateDirectory | Out-Null
    Assert-True (-not (Test-Path -LiteralPath $Journal.lastGoodDirectory)) 'last-good already exists'
    Set-Phase $Journal 'canonical-to-last-good-pending'
  }
  if ($Journal.phase -ceq 'canonical-to-last-good-pending') {
    if ((Test-Path -LiteralPath $Journal.canonicalDirectory) -and -not (Test-Path -LiteralPath $Journal.lastGoodDirectory)) {
      Move-DirectoryDurable $Journal.canonicalDirectory $Journal.lastGoodDirectory
    } elseif ((Test-Path -LiteralPath $Journal.canonicalDirectory) -or -not (Test-Path -LiteralPath $Journal.lastGoodDirectory)) {
      throw 'ambiguous canonical-to-last-good boundary'
    }
    Set-Phase $Journal 'canonical-at-last-good'
  }
  if ($Journal.phase -ceq 'canonical-at-last-good') {
    if (-not $script:SelfTesting) {
      Assert-ExecutableIdentity (Join-Path $Journal.lastGoodDirectory $script:ProductExecutable) $script:Request.currentExecutableSha256 $script:Request.currentVersion
    }
    Assert-RealDirectory $Journal.candidateDirectory | Out-Null
    Assert-True (-not (Test-Path -LiteralPath $Journal.canonicalDirectory)) 'canonical unexpectedly exists before candidate move'
    Set-Phase $Journal 'candidate-to-canonical-pending'
  }
  if ($Journal.phase -ceq 'candidate-to-canonical-pending') {
    if ((Test-Path -LiteralPath $Journal.candidateDirectory) -and -not (Test-Path -LiteralPath $Journal.canonicalDirectory)) {
      Move-DirectoryDurable $Journal.candidateDirectory $Journal.canonicalDirectory
    } elseif ((Test-Path -LiteralPath $Journal.candidateDirectory) -or -not (Test-Path -LiteralPath $Journal.canonicalDirectory)) {
      throw 'ambiguous candidate-to-canonical boundary'
    }
    Set-Phase $Journal 'candidate-at-canonical'
  }
  if ($Journal.phase -ceq 'candidate-at-canonical') {
    if (-not $script:SelfTesting) {
      Assert-ExecutableIdentity (Join-Path $Journal.canonicalDirectory $script:ProductExecutable) $Journal.candidateExecutableSha256 $script:Request.targetVersion
    }
  }
}

function Stop-ExactCandidate($Journal) {
  if ($script:SelfTesting) { return }
  $startedPath = Join-Path (Split-Path -Parent $RequestPath) 'started.json'
  if (-not (Test-Path -LiteralPath $startedPath)) {
    $matching = @(Get-CimInstance Win32_Process -Filter "Name = '$script:ProductExecutable'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -and (Test-SamePath $_.ExecutablePath (Join-Path $Journal.canonicalDirectory $script:ProductExecutable)) })
    Assert-True ($matching.Count -eq 0) 'unbound candidate process prevents rollback'
    return
  }
  $started = Read-BoundedJson $startedPath
  Assert-ExactProperties $started (@('schemaVersion', 'documentType') + (Get-IdentityProperties) + @('pid', 'executable', 'executableSha256', 'startedAt'))
  Assert-True ($started.schemaVersion -eq 1 -and $started.documentType -ceq 'emate.windows-update-started') 'candidate started type rejected'
  Assert-CommitIdentity $started $script:Request
  Assert-True ([int]$started.pid -gt 1) 'candidate PID rejected'
  Assert-True (Test-SamePath $started.executable (Join-Path $Journal.canonicalDirectory $script:ProductExecutable)) 'candidate executable path rejected'
  Assert-True ($started.executableSha256 -ceq $Journal.candidateExecutableSha256) 'candidate executable hash rejected'
  if (Test-ProcessPath ([int]$started.pid) $started.executable) {
    Stop-Process -Id ([int]$started.pid) -Force
    Wait-Process -Id ([int]$started.pid) -Timeout 15 -ErrorAction SilentlyContinue
    Assert-True (-not (Test-ProcessPath ([int]$started.pid) $started.executable)) 'candidate did not exit before rollback'
  }
}

function Assert-LastGood($Journal) {
  Assert-RealDirectory $Journal.lastGoodDirectory | Out-Null
  if (-not $script:SelfTesting) {
    Assert-ExecutableIdentity (Join-Path $Journal.lastGoodDirectory $script:ProductExecutable) $script:Request.currentExecutableSha256 $script:Request.currentVersion
  }
}

function Remove-RealDirectoryIfPresent([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return }
  Assert-RealDirectory $Path | Out-Null
  Remove-Item -LiteralPath $Path -Recurse -Force
}

function Invoke-Rollback($Journal) {
  if ($Journal.phase -cne 'rolled-back') { Stop-ExactCandidate $Journal }
  if ($Journal.phase -ceq 'canonical-to-last-good-pending') {
    $canonicalExists = Test-Path -LiteralPath $Journal.canonicalDirectory
    $lastGoodExists = Test-Path -LiteralPath $Journal.lastGoodDirectory
    if ($canonicalExists -and -not $lastGoodExists) {
      if (-not $script:SelfTesting) {
        Assert-ExecutableIdentity (Join-Path $Journal.canonicalDirectory $script:ProductExecutable) $script:Request.currentExecutableSha256 $script:Request.currentVersion
      }
      Set-Phase $Journal 'rolled-back'
    } elseif (-not $canonicalExists -and $lastGoodExists) {
      Assert-LastGood $Journal
      Set-Phase $Journal 'rollback-last-good-pending'
    } else {
      throw 'ambiguous rollback at canonical-to-last-good boundary'
    }
  }
  if ($Journal.phase -ceq 'canonical-at-last-good') {
    Assert-LastGood $Journal
    Assert-True (-not (Test-Path -LiteralPath $Journal.canonicalDirectory)) 'canonical exists before pre-candidate rollback'
    Set-Phase $Journal 'rollback-last-good-pending'
  }
  if ($Journal.phase -ceq 'candidate-to-canonical-pending') {
    Assert-LastGood $Journal
    $candidateExists = Test-Path -LiteralPath $Journal.candidateDirectory
    $canonicalExists = Test-Path -LiteralPath $Journal.canonicalDirectory
    if ($candidateExists -and -not $canonicalExists) {
      Set-Phase $Journal 'rollback-last-good-pending'
    } elseif (-not $candidateExists -and $canonicalExists) {
      Set-Phase $Journal 'rollback-candidate-pending'
    } else {
      throw 'ambiguous rollback at candidate-to-canonical boundary'
    }
  }
  if (@('candidate-at-canonical', 'awaiting-ack', 'confirmation-pending') -contains $Journal.phase) {
    Assert-LastGood $Journal
    Set-Phase $Journal 'rollback-candidate-pending'
  }
  if ($Journal.phase -ceq 'rollback-candidate-pending') {
    Assert-LastGood $Journal
    if ((Test-Path -LiteralPath $Journal.canonicalDirectory) -and -not (Test-Path -LiteralPath $Journal.failedDirectory)) {
      Move-DirectoryDurable $Journal.canonicalDirectory $Journal.failedDirectory
    } elseif ((Test-Path -LiteralPath $Journal.canonicalDirectory) -or -not (Test-Path -LiteralPath $Journal.failedDirectory)) {
      throw 'ambiguous rollback candidate boundary'
    }
    Set-Phase $Journal 'candidate-at-failed'
  }
  if ($Journal.phase -ceq 'candidate-at-failed') {
    Assert-LastGood $Journal
    Assert-True (-not (Test-Path -LiteralPath $Journal.canonicalDirectory)) 'canonical exists before last-good restore'
    Set-Phase $Journal 'rollback-last-good-pending'
  }
  if ($Journal.phase -ceq 'rollback-last-good-pending') {
    if ((Test-Path -LiteralPath $Journal.lastGoodDirectory) -and -not (Test-Path -LiteralPath $Journal.canonicalDirectory)) {
      Assert-LastGood $Journal
      Move-DirectoryDurable $Journal.lastGoodDirectory $Journal.canonicalDirectory
    } elseif ((Test-Path -LiteralPath $Journal.lastGoodDirectory) -or -not (Test-Path -LiteralPath $Journal.canonicalDirectory)) {
      throw 'ambiguous rollback last-good boundary'
    }
    if (-not $script:SelfTesting) {
      Assert-ExecutableIdentity (Join-Path $Journal.canonicalDirectory $script:ProductExecutable) $script:Request.currentExecutableSha256 $script:Request.currentVersion
    }
    Set-Phase $Journal 'rolled-back'
  }
  if ($Journal.phase -ceq 'rolled-back' -and -not $script:SelfTesting) {
    Assert-ExecutableIdentity (Join-Path $Journal.canonicalDirectory $script:ProductExecutable) $script:Request.currentExecutableSha256 $script:Request.currentVersion
  }
  Remove-RealDirectoryIfPresent $Journal.failedDirectory
  Remove-RealDirectoryIfPresent $Journal.candidateDirectory
}

function Invoke-StagedRollback($Journal, $Request) {
  Assert-True (@('staged', 'ready') -contains $Journal.phase) 'staged rollback phase rejected'
  Assert-RealDirectory $Journal.canonicalDirectory | Out-Null
  Assert-True (-not (Test-Path -LiteralPath $Journal.lastGoodDirectory)) 'last-good exists before the first rename'
  Assert-True (-not (Test-Path -LiteralPath $Journal.failedDirectory)) 'failed directory exists before the first rename'
  if (-not $script:SelfTesting) { Assert-OriginalCurrent $Request }
  Set-Phase $Journal 'rolled-back'
  Remove-RealDirectoryIfPresent $Journal.candidateDirectory
}

function Clear-AttemptFiles($Request) {
  foreach ($name in @('started.json', 'ack.json', 'applied.json')) {
    Remove-FileDurable (Join-Path $Request.mailboxPath $name)
  }
}

function Invoke-Prepare {
  $request = Read-Request
  $script:Request = $request
  Assert-InstallerContext $request
  Register-Recovery $request
  Ensure-TransactionDirectories $request
  Acquire-TransactionLease $request
  $journalPath = Join-Path $request.transactionRoot 'journal.json'
  if (Test-Path -LiteralPath $journalPath) {
    $journal = Read-BoundedJson $journalPath
    Assert-JournalIdentity $journal $request
    if ($journal.phase -ceq 'staging') {
      Assert-OriginalCurrent $request
      Remove-RealDirectoryIfPresent $journal.candidateDirectory
      [IO.Directory]::CreateDirectory($journal.candidateDirectory) | Out-Null
      Write-ResultIni 'stage' $journal
    } else {
      Write-ResultIni 'resume' $journal
    }
    return
  }
  Assert-OriginalCurrent $request
  $journal = New-Journal $request
  [IO.Directory]::CreateDirectory($journal.candidateDirectory) | Out-Null
  Write-Journal $journal
  Write-ResultIni 'stage' $journal
}

function Assert-Candidate($Journal, $Request) {
  $candidate = Assert-RealFile $Journal.candidateExecutable
  $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($candidate.FullName).ProductVersion
  Assert-True ($version -ceq $Request.targetVersion) 'candidate executable version mismatch'
  $Journal.candidateExecutableSha256 = Get-Sha256 $candidate.FullName
}

function Invoke-Apply {
  $request = Read-Request
  $script:Request = $request
  $journal = Read-BoundedJson (Join-Path $request.transactionRoot 'journal.json')
  Assert-JournalIdentity $journal $request
  if ($journal.phase -ceq 'staging') {
    Assert-Candidate $journal $request
    Set-Phase $journal 'staged'
  }
  if (@('rollback-candidate-pending', 'candidate-at-failed', 'rollback-last-good-pending') -contains $journal.phase) {
    Invoke-Rollback $journal
    Finalize-Transaction $request
    Write-ResultIni 'rolled-back' $journal
    return
  }
  if ($journal.phase -ceq 'rolled-back') {
    Invoke-Rollback $journal
    Finalize-Transaction $request
    Write-ResultIni 'rolled-back' $journal
    return
  }
  if (@('candidate-at-canonical', 'awaiting-ack') -contains $journal.phase -or
    ($journal.phase -ceq 'confirmation-pending' -and -not (Test-Path -LiteralPath (Join-Path $request.mailboxPath 'confirmation.json')))) {
    Invoke-Rollback $journal
    Finalize-Transaction $request
    Write-ResultIni 'rolled-back' $journal
    return
  }
  if (@('staged', 'ready') -contains $journal.phase) {
    Write-Ready $request
    if ($journal.phase -ceq 'staged') { Set-Phase $journal 'ready' }
    $shutdown = Wait-ShutdownWhileParentLives $request
    if ($null -eq $shutdown) {
      Invoke-StagedRollback $journal $request
      Finalize-Transaction $request
      Write-ResultIni 'rolled-back' $journal
      return
    }
    Assert-True ([int]$shutdown.parentPid -eq [int]$request.parentPid) 'shutdown PID mismatch'
    Wait-ParentExit $request
  } else {
    Write-Ready $request
  }
  try {
    Invoke-Swap $journal
  } catch {
    $swapFailure = $_.Exception.Message
    try {
      if (@('staged', 'ready') -contains $journal.phase) {
        Invoke-StagedRollback $journal $request
      } else {
        Invoke-Rollback $journal
      }
      Finalize-Transaction $request
      Write-ResultIni 'rolled-back' $journal
      return
    } catch {
      throw "$swapFailure; rollback failed: $($_.Exception.Message)"
    }
  }
  $confirmationPath = Join-Path $request.mailboxPath 'confirmation.json'
  if ($journal.phase -ceq 'confirmation-pending' -and (Test-Path -LiteralPath $confirmationPath)) {
    $confirmation = Read-BoundedJson $confirmationPath
    Assert-ExactProperties $confirmation (@('schemaVersion', 'documentType') + (Get-IdentityProperties) + @('confirmedAt'))
    Assert-True ($confirmation.schemaVersion -eq 1 -and $confirmation.documentType -ceq 'emate.windows-update-confirmed') 'confirmation type rejected'
    Assert-CommitIdentity $confirmation $request
    Set-Phase $journal 'confirmed'
  }
  if (@('confirmed', 'confirmed-unknown') -contains $journal.phase) {
    $startedPath = Join-Path $request.mailboxPath 'started.json'
    if (Test-Path -LiteralPath $startedPath) {
      $started = Read-BoundedJson $startedPath
      Assert-CommitIdentity $started $request
      if (Test-ProcessPath ([int]$started.pid) $started.executable) {
        Write-ResultIni 'monitor' $journal
        return
      }
    }
    Clear-AttemptFiles $request
  }
  if ($journal.phase -ceq 'applied') {
    if (-not $script:SelfTesting) {
      Assert-ExecutableIdentity (Join-Path $journal.canonicalDirectory $script:ProductExecutable) $journal.candidateExecutableSha256 $request.targetVersion
    }
    Remove-RealDirectoryIfPresent $journal.lastGoodDirectory
    Set-Phase $journal 'completed'
  }
  if ($journal.phase -ceq 'completed') {
    Finalize-Transaction $request
    Write-ResultIni 'committed' $journal
    return
  }
  Write-ResultIni 'launch' $journal
}

function Invoke-Monitor {
  $request = Read-Request
  $script:Request = $request
  $journalPath = Join-Path $request.transactionRoot 'journal.json'
  $journal = Read-BoundedJson $journalPath
  Assert-JournalIdentity $journal $request
  if ($journal.phase -ceq 'candidate-at-canonical') { Set-Phase $journal 'awaiting-ack' }
  try {
    $started = Wait-Document (Join-Path $request.mailboxPath 'started.json') 'emate.windows-update-started' $request $script:StartupTimeoutSeconds
    Assert-True ([int]$started.pid -gt 1) 'candidate PID rejected'
    Assert-True (Test-SamePath $started.executable (Join-Path $journal.canonicalDirectory $script:ProductExecutable)) 'candidate path rejected'
    Assert-True ($started.executableSha256 -ceq $journal.candidateExecutableSha256) 'candidate hash rejected'
    Assert-True (Test-ProcessPath ([int]$started.pid) $started.executable) 'candidate exited before health ACK'
    $ack = Wait-Document (Join-Path $request.mailboxPath 'ack.json') 'emate.windows-update-ack' $request $script:StartupTimeoutSeconds
    Assert-True ([int]$ack.pid -eq [int]$started.pid -and $ack.executableSha256 -ceq $journal.candidateExecutableSha256) 'candidate ACK identity rejected'
  } catch {
    if (@('candidate-at-canonical', 'awaiting-ack', 'confirmation-pending') -contains $journal.phase) {
      Invoke-Rollback $journal
      Finalize-Transaction $request
      Write-ResultIni 'rolled-back' $journal
      return
    }
    throw
  }
  if (@('awaiting-ack', 'candidate-at-canonical') -contains $journal.phase) {
    Set-Phase $journal 'confirmation-pending'
    Write-DurableJson (Join-Path $request.mailboxPath 'confirmation.json') ([ordered]@{
      schemaVersion = 1
      documentType = 'emate.windows-update-confirmed'
      transactionId = $request.transactionId
      token = $request.token
      targetVersion = $request.targetVersion
      sourceCommit = $request.sourceCommit
      baseContractId = $request.baseContractId
      scheduleProtocolFloor = [int]$request.scheduleProtocolFloor
      manifestIdentity = $request.manifestIdentity
      artifact = $request.artifact
      canonicalDirectory = $request.canonicalDirectory
      transactionRoot = $request.transactionRoot
      confirmedAt = Get-UtcIsoTimestamp
    }) -Exclusive
    Set-Phase $journal 'confirmed'
  }
  try {
    $applied = Wait-Document (Join-Path $request.mailboxPath 'applied.json') 'emate.windows-update-applied' $request $script:StartupTimeoutSeconds
    Assert-True ([int]$applied.pid -eq [int]$started.pid -and $applied.executableSha256 -ceq $journal.candidateExecutableSha256) 'candidate APPLIED identity rejected'
  } catch {
    Set-Phase $journal 'confirmed-unknown'
    Write-ResultIni 'forward-only' $journal
    return
  }
  Set-Phase $journal 'applied'
  if (-not $script:SelfTesting) {
    Assert-ExecutableIdentity (Join-Path $journal.canonicalDirectory $script:ProductExecutable) $journal.candidateExecutableSha256 $request.targetVersion
  }
  Remove-RealDirectoryIfPresent $journal.lastGoodDirectory
  Set-Phase $journal 'completed'
  Finalize-Transaction $request
  Write-ResultIni 'committed' $journal
}

function New-SelfTestTree {
  $root = Join-Path ([IO.Path]::GetTempPath()) ('emate-update-selftest-' + [Guid]::NewGuid().ToString('D'))
  $canonical = Join-Path $root 'e-Mate'
  $transaction = Join-Path (Join-Path $root '.net.ecoremedia.e-mate-update') ([Guid]::NewGuid().ToString('D'))
  $candidate = Join-Path $transaction 'candidate'
  [IO.Directory]::CreateDirectory($canonical) | Out-Null
  [IO.Directory]::CreateDirectory($candidate) | Out-Null
  [IO.File]::WriteAllText((Join-Path $canonical 'identity'), 'old')
  [IO.File]::WriteAllText((Join-Path $candidate 'identity'), 'new')
  $journal = [ordered]@{
    phase = 'staged'
    canonicalDirectory = $canonical
    transactionRoot = $transaction
    candidateDirectory = $candidate
    lastGoodDirectory = (Join-Path $transaction 'last-good')
    failedDirectory = (Join-Path $transaction 'failed')
    candidateExecutableSha256 = ('a' * 64)
    updatedAt = Get-UtcIsoTimestamp
  }
  return @{ root = $root; journal = $journal }
}

function Assert-OldCanonical($Tree) {
  Assert-True (Test-Path -LiteralPath $Tree.journal.canonicalDirectory) 'canonical was not restored'
  Assert-True (([IO.File]::ReadAllText((Join-Path $Tree.journal.canonicalDirectory 'identity'))) -ceq 'old') 'canonical is not last-good'
}

function Assert-NewCanonical($Tree) {
  Assert-True (Test-Path -LiteralPath $Tree.journal.canonicalDirectory) 'candidate was not installed at canonical'
  Assert-True (([IO.File]::ReadAllText((Join-Path $Tree.journal.canonicalDirectory 'identity'))) -ceq 'new') 'canonical is not the candidate'
}

function Invoke-SelfTest {
  $script:SelfTesting = $true
  Assert-True ((Get-UtcIsoTimestamp) -cmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$') 'transaction timestamp is not canonical UTC ISO'
  $removalRoot = Join-Path ([IO.Path]::GetTempPath()) ('emate-update-removal-selftest-' + [Guid]::NewGuid().ToString('D'))
  [IO.Directory]::CreateDirectory($removalRoot) | Out-Null
  try {
    $removalFile = Join-Path $removalRoot 'active.json'
    [IO.File]::WriteAllText($removalFile, '{}')
    Remove-FileDurable $removalFile
    Assert-True (-not (Test-Path -LiteralPath $removalFile)) 'durable file removal left the authoritative path'
  } finally {
    Remove-Item -LiteralPath $removalRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
    $self = Get-Process -Id $PID
    Assert-True (Test-ProcessPath $PID $self.Path) 'self-test process identity failed'
    $script:RecoveryKeyOverride = 'Registry::HKEY_CURRENT_USER\Software\net.ecoremedia.e-mate\UpdateSelfTest-' + [Guid]::NewGuid().ToString('D')
    $recoveryRequest = [ordered]@{
      ownerSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
      transactionId = [Guid]::NewGuid().ToString('D')
      installerPath = $self.Path
      token = [Guid]::NewGuid().ToString('D')
    }
    try {
      Assert-True (-not (Test-Path -LiteralPath $script:RecoveryKeyOverride)) 'recovery self-test key already exists'
      Register-Recovery $recoveryRequest
      $registered = Get-ItemPropertyValue -LiteralPath $script:RecoveryKeyOverride -Name (Get-RecoveryName $recoveryRequest)
      Assert-True ($registered -ceq (Get-RecoveryCommand $recoveryRequest)) 'missing-key recovery registration failed'
      Remove-Recovery $recoveryRequest
      $removed = Get-ItemPropertyValue -LiteralPath $script:RecoveryKeyOverride -Name (Get-RecoveryName $recoveryRequest) -ErrorAction SilentlyContinue
      Assert-True ($null -eq $removed) 'recovery self-test value was not removed'
    } finally {
      Remove-Item -LiteralPath $script:RecoveryKeyOverride -Recurse -Force -ErrorAction SilentlyContinue
      $script:RecoveryKeyOverride = $null
    }
  }
  $swapBoundaries = @(
    'canonical-to-last-good-pending', 'canonical-at-last-good',
    'candidate-to-canonical-pending', 'candidate-at-canonical'
  )
  foreach ($boundary in $swapBoundaries) {
    $tree = New-SelfTestTree
    try {
      $script:FailAfterPhase = $boundary
      try { Invoke-Swap $tree.journal } catch { }
      $script:FailAfterPhase = $null
      Invoke-Swap $tree.journal
      $tree.journal.phase = 'candidate-at-canonical'
      $script:Request = [ordered]@{}
      Invoke-Rollback $tree.journal
      Assert-OldCanonical $tree
    } finally {
      $script:FailAfterPhase = $null
      Remove-Item -LiteralPath $tree.root -Recurse -Force -ErrorAction SilentlyContinue
    }
    $rollbackTree = New-SelfTestTree
    try {
      $script:FailAfterPhase = $boundary
      try { Invoke-Swap $rollbackTree.journal } catch { }
      $script:FailAfterPhase = $null
      $script:Request = [ordered]@{}
      Invoke-Rollback $rollbackTree.journal
      Assert-OldCanonical $rollbackTree
    } finally {
      $script:FailAfterPhase = $null
      Remove-Item -LiteralPath $rollbackTree.root -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  foreach ($boundary in @('rollback-candidate-pending', 'candidate-at-failed', 'rollback-last-good-pending', 'rolled-back')) {
    $tree = New-SelfTestTree
    try {
      Invoke-Swap $tree.journal
      $tree.journal.phase = 'candidate-at-canonical'
      $script:Request = [ordered]@{}
      $script:FailAfterPhase = $boundary
      try { Invoke-Rollback $tree.journal } catch { }
      $script:FailAfterPhase = $null
      Invoke-Rollback $tree.journal
      Assert-OldCanonical $tree
    } finally {
      $script:FailAfterPhase = $null
      Remove-Item -LiteralPath $tree.root -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
  $success = New-SelfTestTree
  try {
    Invoke-Swap $success.journal
    Assert-NewCanonical $success
    Assert-True (([IO.File]::ReadAllText((Join-Path $success.journal.lastGoodDirectory 'identity'))) -ceq 'old') 'successful swap lost last-good before commit'
  } finally {
    Remove-Item -LiteralPath $success.root -Recurse -Force -ErrorAction SilentlyContinue
  }
  $leaseRoot = Join-Path ([IO.Path]::GetTempPath()) ('emate-update-lease-selftest-' + [Guid]::NewGuid().ToString('D'))
  $leaseContainer = Join-Path $leaseRoot ".$script:AppId-update"
  [IO.Directory]::CreateDirectory($leaseContainer) | Out-Null
  $firstLease = [ordered]@{
    transactionRoot = Join-Path $leaseContainer ([Guid]::NewGuid().ToString('D'))
    transactionId = [Guid]::NewGuid().ToString('D')
    token = [Guid]::NewGuid().ToString('D')
  }
  $secondLease = [ordered]@{
    transactionRoot = Join-Path $leaseContainer ([Guid]::NewGuid().ToString('D'))
    transactionId = [Guid]::NewGuid().ToString('D')
    token = [Guid]::NewGuid().ToString('D')
  }
  $savedRequestPath = $script:RequestPath
  try {
    $script:RequestPath = Join-Path $leaseRoot 'first-request.json'
    Acquire-TransactionLease $firstLease
    $script:RequestPath = Join-Path $leaseRoot 'second-request.json'
    $secondRejected = $false
    try { Acquire-TransactionLease $secondLease } catch { $secondRejected = $true }
    Assert-True $secondRejected 'a second transaction acquired another owner lease'
    $script:RequestPath = Join-Path $leaseRoot 'first-request.json'
    Release-TransactionLease $firstLease
    Assert-True (-not (Test-Path -LiteralPath (Get-LeasePath $firstLease))) 'owner lease was not durably released'
  } finally {
    $script:RequestPath = $savedRequestPath
    Remove-Item -LiteralPath $leaseRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  $first = New-SelfTestTree
  $second = New-SelfTestTree
  try {
    Invoke-StagedRollback $first.journal ([ordered]@{})
    Assert-OldCanonical $first
    Assert-True (-not (Test-Path -LiteralPath $first.journal.candidateDirectory)) 'aborted candidate was not removed'
    Assert-True (([IO.File]::ReadAllText((Join-Path $second.journal.candidateDirectory 'identity'))) -ceq 'new') 'another transaction was modified'
  } finally {
    Remove-Item -LiteralPath $first.root -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $second.root -Recurse -Force -ErrorAction SilentlyContinue
  }
  $script:SelfTesting = $false
  [Console]::Out.WriteLine('windows update transaction self-test passed')
}

try {
  switch ($Operation) {
    'Prepare' { Invoke-Prepare }
    'Apply' { Invoke-Apply }
    'Monitor' { Invoke-Monitor }
    'SelfTest' { Invoke-SelfTest }
  }
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
