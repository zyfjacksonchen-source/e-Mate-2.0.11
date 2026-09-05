# SPDX-License-Identifier: MIT
# Copyright (c) 2026 anionex; Windows adaptations copyright (c) 2026 e-Mate contributors.
# Incorporates limited MIT-licensed primitives copyright (c) 2026 jing-hy from
# jing-hy/computer-user@2fbf383b49fe08e466d4d1caba659fb42b61de6b. Full notices: ../../LICENSE and ../../SOURCE.md.
# Adapted only from src/input.ps1 (bounded key-name mapping) and src/capture.ps1
# (DPI awareness and CopyFromScreen), with capture restricted to the bound HWND frame and host path.
# Fixed JSON stdin/stdout protocol; no model-selected command or path.
$ErrorActionPreference = 'Stop'
try {
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  [Console]::InputEncoding = $utf8
  [Console]::OutputEncoding = $utf8
  $OutputEncoding = $utf8
} catch {
  [Console]::Error.WriteLine('Windows helper UTF-8 stream initialization failed')
  exit 2
}

function Reply-Ok($value) { [Console]::Out.WriteLine((ConvertTo-Json -Depth 40 -Compress @{ ok = $true; value = $value })); exit 0 }
function Reply-Fail([string]$code, [string]$message) { [Console]::Out.WriteLine((ConvertTo-Json -Compress @{ ok = $false; error = @{ code = $code; message = $message.Substring(0, [Math]::Min(1000, $message.Length)) } })); exit 2 }
function Assert-Int($value, [int64]$min, [int64]$max, [string]$name) { if ($null -eq $value -or [int64]$value -lt $min -or [int64]$value -gt $max) { throw "$name is out of bounds" }; return [int64]$value }

try {
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing -ErrorAction Stop
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class EmateWin32 {
  public delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll", SetLastError=true)] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr data);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool ScreenToClient(IntPtr hwnd, ref POINT point);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
  [DllImport("user32.dll", SetLastError=true)] public static extern bool CloseDesktop(IntPtr desktop);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
  [DllImport("kernel32.dll")] public static extern uint WTSGetActiveConsoleSessionId();
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token, int cls, out int value, int size, out int returned);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static bool IsElevated(uint pid) { IntPtr p=OpenProcess(0x1000,false,pid),t=IntPtr.Zero; if(p==IntPtr.Zero)throw new System.ComponentModel.Win32Exception(); try { if(!OpenProcessToken(p,8,out t))throw new System.ComponentModel.Win32Exception(); int v,n; if(!GetTokenInformation(t,20,out v,4,out n))throw new System.ComponentModel.Win32Exception(); return v!=0; } finally { if(t!=IntPtr.Zero)CloseHandle(t);CloseHandle(p); } }
  public static bool InputDesktopAvailable() { IntPtr d=OpenInputDesktop(0,false,0x0100); if(d==IntPtr.Zero)return false; return CloseDesktop(d); }
  public static long Pack(int x,int y) { return ((uint)(y & 0xffff) << 16) | (uint)(x & 0xffff); }
  public static bool Send(IntPtr h,uint m,long w,long l) { IntPtr r; return SendMessageTimeout(h,m,(IntPtr)w,(IntPtr)l,2,2000,out r)!=IntPtr.Zero; }
}
'@ -ErrorAction Stop
try { Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class EmateDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }' -ErrorAction Stop; if (-not [EmateDpi]::SetProcessDPIAware()) { throw 'SetProcessDPIAware failed' } } catch { throw "DPI authority unavailable: $($_.Exception.Message)" }
} catch { Reply-Fail 'COMPUTER_PROVIDER_FAILURE' "Windows UI Automation/Win32 authority unavailable: $($_.Exception.Message)" }

function Assert-Interactive {
  if (-not [Environment]::UserInteractive) { throw 'locked or noninteractive Windows session' }
  if (-not [EmateWin32]::InputDesktopAvailable()) { throw 'secure desktop or locked session is active' }
  $current = [System.Diagnostics.Process]::GetCurrentProcess()
  $active = [EmateWin32]::WTSGetActiveConsoleSessionId()
  if ($active -ne 0xffffffff -and $current.SessionId -ne $active) { throw 'unsupported RDP/session transition' }
}
function Get-Health {
  $uia='unavailable'; $capture='unavailable'
  try { $root=[Windows.Automation.AutomationElement]::RootElement; if($null-eq$root){throw 'UI Automation desktop root unavailable'}; $null=$root.Current.Name; $uia='granted' } catch { $uia='unavailable' }
  try { $bmp=New-Object Drawing.Bitmap(1,1); try { $g=[Drawing.Graphics]::FromImage($bmp); try { $g.CopyFromScreen(0,0,0,0,(New-Object Drawing.Size(1,1))) } finally { $g.Dispose() } } finally { $bmp.Dispose() }; $capture='granted' } catch { $capture='unavailable' }
  return @{helperVersion='1.0.0';accessibility=$uia;screenRecording=$capture}
}
function Get-Frame([IntPtr]$hwnd) {
  $r = New-Object EmateWin32+RECT
  if (-not [EmateWin32]::GetWindowRect($hwnd, [ref]$r)) { throw "GetWindowRect failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $w = $r.Right-$r.Left; $h=$r.Bottom-$r.Top
  if ($w -le 0 -or $h -le 0 -or $w -gt 32768 -or $h -gt 32768) { throw 'target window frame is invalid' }
  return [ordered]@{ x=$r.Left; y=$r.Top; width=$w; height=$h }
}
function Get-App([IntPtr]$hwnd) {
  [uint32]$targetProcessId=0
  if ([EmateWin32]::GetWindowThreadProcessId($hwnd,[ref]$targetProcessId) -eq 0 -or $targetProcessId -eq 0) { throw "GetWindowThreadProcessId failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  $process=[Diagnostics.Process]::GetProcessById([int]$targetProcessId)
  try { $path=$process.MainModule.FileName; $start=$process.StartTime.ToUniversalTime().Ticks.ToString(); $name=$process.ProcessName }
  catch { throw 'target executable identity unavailable (elevated/UIPI target may require unavailable authority)' }
  try { if ([EmateWin32]::IsElevated($targetProcessId)) { throw 'elevated/UIPI target is not supported' } } catch { throw "target integrity authority unavailable: $($_.Exception.Message)" }
  return [ordered]@{ bundleId=$path.ToLowerInvariant(); pid=[int]$targetProcessId; name=$name; executablePath=$path; processStartTime=$start; windowId=$hwnd.ToInt64() }
}
function Same-App($expected,$actual) {
  return ([int]$expected.pid -eq [int]$actual.pid -and [string]$expected.bundleId -ceq [string]$actual.bundleId -and [string]$expected.executablePath -ceq [string]$actual.executablePath -and [string]$expected.processStartTime -ceq [string]$actual.processStartTime -and [int64]$expected.windowId -eq [int64]$actual.windowId)
}
function Get-Windows {
  $rows=New-Object System.Collections.Generic.List[object]
  $callback=[EmateWin32+EnumWindowsProc]{ param($h,$unused) if ([EmateWin32]::IsWindowVisible($h)) { try { $f=Get-Frame $h; if ($f.width -gt 0 -and $f.height -gt 0) { $rows.Add($h) } } catch {} }; return $true }
  if (-not [EmateWin32]::EnumWindows($callback,[IntPtr]::Zero)) { throw "EnumWindows failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())" }
  return $rows.ToArray()
}
function Resolve-App($selector) {
  $matches=@()
  foreach($h in Get-Windows) { try { $a=Get-App $h; if (($null -ne $selector.pid -and $a.pid -eq [int]$selector.pid) -or ($selector.bundleId -and ($a.bundleId -ceq [string]$selector.bundleId -or $a.executablePath -ceq [string]$selector.bundleId)) -or ($selector.name -and $a.name -ceq [string]$selector.name)) { $matches += ,@($h,$a) } } catch {} }
  if ($matches.Count -ne 1) { throw "application selector must resolve to exactly one visible HWND; found $($matches.Count)" }
  return $matches[0][1]
}
function Assert-Target($app,[IntPtr]$hwnd) {
  if (-not [EmateWin32]::IsWindow($hwnd)) { throw 'target HWND is missing or replaced' }
  $actual=Get-App $hwnd
  if (-not (Same-App $app $actual)) { throw 'target executable/PID/start-time/HWND identity changed' }
  return $actual
}
function Element-String($element,[string]$property,[int]$max=4096) {
  try { $v=[string]$element.GetCurrentPropertyValue([Windows.Automation.AutomationElement]::$property,$true); if ($v.Length -gt $max) { return $v.Substring(0,$max) }; return $v } catch { return '' }
}
function Get-Tree([IntPtr]$hwnd,[int]$maxNodes,[int]$maxDepth,[int]$maxTextBytes) {
  $root=[Windows.Automation.AutomationElement]::FromHandle($hwnd); if ($null -eq $root) { throw 'UI Automation root unavailable' }
  $walker=[Windows.Automation.TreeWalker]::ControlViewWalker; $items=New-Object System.Collections.Generic.List[object]; $lines=New-Object System.Collections.Generic.List[string]; $state=@{truncated=$false}
  function Visit($element,[int[]]$locator,[int]$depth) {
    if ($items.Count -ge $maxNodes -or $depth -gt $maxDepth) { $state.truncated=$true; return }
    $role=Element-String $element 'ControlTypeProperty'; if ($role.StartsWith('ControlType.')) { $role=$role.Substring(12) }
    $name=Element-String $element 'NameProperty'; $aid=Element-String $element 'AutomationIdProperty'; $value=''
    $actions=New-Object System.Collections.Generic.List[string]
    $pattern=$null; if ($element.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) { $actions.Add('AXPress') }
    $pattern=$null; if ($element.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) { $actions.Add('AXSetValue'); try { $value=[string]$pattern.Current.Value } catch {} }
    $b=$element.Current.BoundingRectangle; $frame=$null; if (-not $b.IsEmpty -and $b.Width -gt 0 -and $b.Height -gt 0) { $frame=[ordered]@{x=$b.X;y=$b.Y;width=$b.Width;height=$b.Height} }
    $item=[ordered]@{ index=$items.Count; locator=@($locator); role=$role; actions=$actions.ToArray(); enabled=[bool]$element.Current.IsEnabled; focused=[bool]$element.Current.HasKeyboardFocus }
    if ($name) { $item.label=$name }; if ($aid) { $item.nativeIdentifier=$aid }; if ($value.Length -gt 0) { $item.value=$value.Substring(0,[Math]::Min(8192,$value.Length)) }; if ($null -ne $frame) { $item.frame=$frame }
    $items.Add($item); $line=('['+$item.index+'] '+$role+$(if($name){' '+$name}else{''})); if ([Text.Encoding]::UTF8.GetByteCount(($lines -join "
")+"
"+$line) -le $maxTextBytes) { $lines.Add($line) } else { $state.truncated=$true }
    if ($depth -eq $maxDepth) { return }; $child=$walker.GetFirstChild($element); $i=0; while($null -ne $child) { Visit $child (@($locator)+$i) ($depth+1); if($items.Count -ge $maxNodes){break}; $child=$walker.GetNextSibling($child); $i++ }
  }
  Visit $root @() 0
  return @{ root=$root; elements=$items.ToArray(); text=($lines -join "
"); truncated=[bool]$state.truncated }
}
function Get-StateHash($app,$window,$frontmost,$elements) { $canonical=([ordered]@{app=$app;window=$window;frontmost=[bool]$frontmost;elements=@($elements)}|ConvertTo-Json -Depth 40 -Compress); $sha=[Security.Cryptography.SHA256]::Create(); try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() } }
function Capture-Window([IntPtr]$hwnd,$frame,[string]$path) {
  if ([IO.Path]::GetExtension($path).ToLowerInvariant() -ne '.png' -or -not [IO.Path]::IsPathRooted($path)) { throw 'screenshot path must be an absolute PNG allocated by the host' }
  $bmp=New-Object Drawing.Bitmap([int]$frame.width,[int]$frame.height); try { $g=[Drawing.Graphics]::FromImage($bmp); try { $g.CopyFromScreen([int]$frame.x,[int]$frame.y,0,0,(New-Object Drawing.Size([int]$frame.width,[int]$frame.height))) } finally { $g.Dispose() }; $bmp.Save($path,[Drawing.Imaging.ImageFormat]::Png) } finally { $bmp.Dispose() }
  $info=[IO.FileInfo]$path; if (-not $info.Exists -or $info.Length -le 0 -or $info.Length -gt 268435456) { throw 'screenshot write failed or exceeded bound' }
  return [ordered]@{ path=$path; width=[int]$frame.width; height=[int]$frame.height }
}
function Observe($app,$options) {
  Assert-Interactive; $hwnd=[IntPtr][int64]$app.windowId; $actual=Assert-Target $app $hwnd; $frame=Get-Frame $hwnd
  $maxNodes=Assert-Int $options.maxNodes 10 5000 'maxNodes'; $maxDepth=Assert-Int $options.maxDepth 1 64 'maxDepth'; $maxText=Assert-Int $options.maxTextBytes 1024 1048576 'maxTextBytes'
  $tree=Get-Tree $hwnd $maxNodes $maxDepth $maxText; $window=[ordered]@{ title=(Element-String $tree.root 'NameProperty'); frame=$frame; id=$hwnd.ToInt64() }; $frontmost=([EmateWin32]::GetForegroundWindow() -eq $hwnd)
  $result=[ordered]@{ app=$actual; stateHash=(Get-StateHash $actual $window $frontmost $tree.elements); frontmost=$frontmost; window=$window; treeText=$tree.text; truncated=$tree.truncated; elements=$tree.elements; permissions=@{accessibility='granted';screenRecording='granted'} }
  if ([string]$options.screenshot -ne 'none') { try { $result.screenshot=Capture-Window $hwnd $frame ([string]$options.screenshotPath) } catch { if ([string]$options.screenshot -eq 'required') { throw } } }
  return $result
}
function Resolve-Element($root,$locator) { $walker=[Windows.Automation.TreeWalker]::ControlViewWalker; $current=$root; foreach($part in @($locator)) { $i=0; $child=$walker.GetFirstChild($current); while($i -lt [int]$part -and $null -ne $child) { $child=$walker.GetNextSibling($child); $i++ }; if($null -eq $child){throw 'UI Automation target locator is stale'}; $current=$child }; return $current }
function Ensure-Foreground([IntPtr]$hwnd,[string]$policy) { $before=[EmateWin32]::GetForegroundWindow(); if($before -eq $hwnd){return 'already-frontmost'}; if($policy -ne 'activate'){throw 'configured activation policy denies fallback while target is not foreground'}; if(-not [EmateWin32]::SetForegroundWindow($hwnd)){throw "SetForegroundWindow failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"}; Start-Sleep -Milliseconds 30; if([EmateWin32]::GetForegroundWindow() -ne $hwnd){throw 'foreground HWND/PID verification failed immediately before input'}; return 'activated' }
function Send-Checked([IntPtr]$hwnd,[uint32]$msg,[int64]$w=0,[int64]$l=0) { if(-not [EmateWin32]::Send($hwnd,$msg,$w,$l)){throw "target-window message delivery failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"} }
function Point-LParam([IntPtr]$hwnd,$frame,[double]$x,[double]$y,[string]$space) { if($space -ne 'screen'){ $x+=$frame.x; $y+=$frame.y }; if($x -lt $frame.x -or $y -lt $frame.y -or $x -ge ($frame.x+$frame.width) -or $y -ge ($frame.y+$frame.height)){throw 'input point is outside the exact target window'}; $p=New-Object EmateWin32+POINT; $p.X=[int]$x;$p.Y=[int]$y;if(-not [EmateWin32]::ScreenToClient($hwnd,[ref]$p)){throw "ScreenToClient failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"};return [EmateWin32]::Pack($p.X,$p.Y) }
function Resolve-Key([string]$name) { $keys=@{command=0x5B;control=0x11;option=0x12;shift=0x10;enter=0x0D;tab=0x09;escape=0x1B;space=0x20;backspace=0x08;delete=0x2E;home=0x24;end=0x23;pageup=0x21;pagedown=0x22;arrowup=0x26;arrowdown=0x28;arrowleft=0x25;arrowright=0x27}; $n=$name.ToLowerInvariant(); if($keys.ContainsKey($n)){return $keys[$n]};if($n.Length -eq 1 -and $n[0] -ge 'a' -and $n[0] -le 'z'){return 0x41+([int]$n[0]-97)};if($n.Length -eq 1 -and $n[0] -ge '0' -and $n[0] -le '9'){return 0x30+([int]$n[0]-48)};throw 'unsupported key' }
function Release-Input($app,$window,$action) {
  Assert-Interactive; $hwnd=[IntPtr][int64]$app.windowId; $actual=Assert-Target $app $hwnd; if([int64]$window.id -ne $hwnd.ToInt64()){throw 'cleanup HWND does not match bound app'}
  if($action.kind -eq 'press-key') { $keys=New-Object Collections.Generic.HashSet[int]; foreach($name in @($action.modifiers)+@([string]$action.key)){ $null=$keys.Add((Resolve-Key $name)) }; foreach($vk in $keys){Send-Checked $hwnd 0x0101 $vk 0} }
  elseif($action.kind -eq 'click') { $msg=if($action.button-eq'right'){0x0205}elseif($action.button-eq'middle'){0x0208}else{0x0202}; Send-Checked $hwnd $msg 0 0 }
  elseif($action.kind -eq 'drag') { Send-Checked $hwnd 0x0202 0 0 }
  return @{cleanupComplete=$true;target=@{bundleId=$actual.bundleId;pid=$actual.pid;name=$actual.name;executablePath=$actual.executablePath;processStartTime=$actual.processStartTime;windowId=$actual.windowId}}
}
function Act($request) {
  Assert-Interactive; $app=$request.app; $hwnd=[IntPtr][int64]$app.windowId; $null=Assert-Target $app $hwnd; if([int64]$request.window.id -ne $hwnd.ToInt64()){throw 'action HWND does not match bound app'}
  $current=Observe $app @{screenshot='none';maxNodes=(Assert-Int $request.limits.maxNodes 10 5000 'maxNodes');maxDepth=(Assert-Int $request.limits.maxDepth 1 64 'maxDepth');maxTextBytes=(Assert-Int $request.limits.maxTextBytes 1024 1048576 'maxTextBytes')}; if($current.stateHash -cne [string]$request.expectedStateHash){throw 'stale UI Automation state hash'}
  $f=$current.window.frame; $expected=$request.window.frame; if($f.x-ne$expected.x -or $f.y-ne$expected.y -or $f.width-ne$expected.width -or $f.height-ne$expected.height){throw 'target window moved or resized'}
  $a=$request.action; $activation='not-requested'; $channel='accessibility'; $pointer=$false; $routing='none'; $element=$null; if($null-ne$request.element){$uiaRoot=[Windows.Automation.AutomationElement]::FromHandle($hwnd);if($null-eq$uiaRoot){throw 'UI Automation root unavailable'};$element=Resolve-Element $uiaRoot $request.element.locator}
  if($a.kind -eq 'set-value') { if(([string]$a.value).Length -gt 8192){throw 'text exceeds bound'}; $p=$null;if($null-eq$element -or -not $element.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$p)){throw 'UIA ValuePattern unavailable'};$p.SetValue([string]$a.value) }
  elseif($a.kind -eq 'perform-action' -or ($a.kind -eq 'click' -and $null-ne$element -and @($request.element.actions) -contains 'AXPress')) { $p=$null;if($null-ne$element -and $element.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$p)){$p.Invoke()}elseif($a.kind -eq 'perform-action' -and $a.action -eq 'AXRaise'){$element.SetFocus()}else{throw 'requested UIA pattern unavailable; coordinate fallback was not explicitly selected'} }
  elseif($a.kind -eq 'type-text') { $text=[string]$a.text;if($text.Length -gt 8192){throw 'text exceeds bound'};$activation=Ensure-Foreground $hwnd ([string]$request.interaction.keyboardPolicy);$channel='keyboard';foreach($ch in $text.ToCharArray()){Send-Checked $hwnd 0x0102 ([int]$ch) 0} }
  elseif($a.kind -eq 'press-key') { $mods=@($a.modifiers);if($mods.Count -gt 4 -or ([string]$a.key).Length -gt 32){throw 'key chord exceeds bound'};$activation=Ensure-Foreground $hwnd ([string]$request.interaction.keyboardPolicy);$channel='keyboard';$down=New-Object Collections.Generic.List[int];try{foreach($m in $mods){$vk=Resolve-Key $m;Send-Checked $hwnd 0x0100 $vk 0;$down.Add($vk)};$vk=Resolve-Key ([string]$a.key);Send-Checked $hwnd 0x0100 $vk 0;$down.Add($vk)}finally{for($i=$down.Count-1;$i-ge 0;$i--){Send-Checked $hwnd 0x0101 $down[$i] 0}} }
  else { $activation=Ensure-Foreground $hwnd ([string]$request.interaction.focusPolicy);$channel='coordinates';$pointer=$true;$routing='target-process';$space=if($a.coordinateSpace){[string]$a.coordinateSpace}else{'window'}
    if($a.kind -eq 'click'){ $x=$a.x;$y=$a.y;if($null-ne$element){$b=$element.Current.BoundingRectangle;$x=$b.X+$b.Width/2;$y=$b.Y+$b.Height/2;$space='screen'};$lp=Point-LParam $hwnd $f $x $y $space;$down=0x0201;$up=0x0202;$wp=1;if($a.button-eq'right'){$down=0x0204;$up=0x0205;$wp=2}elseif($a.button-eq'middle'){$down=0x0207;$up=0x0208;$wp=0x10};$count=Assert-Int $(if($a.clickCount){$a.clickCount}else{1}) 1 3 'clickCount';try{for($i=0;$i-lt$count;$i++){Send-Checked $hwnd $down $wp $lp;Send-Checked $hwnd $up 0 $lp}}finally{Send-Checked $hwnd $up 0 $lp} }
    elseif($a.kind -eq 'scroll'){ $lp=Point-LParam $hwnd $f $a.x $a.y $space;$pages=Assert-Int $(if($a.pages){$a.pages}else{1}) 1 10 'pages';$delta=120*$pages;if($a.direction-eq'down'-or$a.direction-eq'right'){$delta=-$delta};$msg=if($a.direction-eq'left'-or$a.direction-eq'right'){0x020E}else{0x020A};Send-Checked $hwnd $msg ([int64]$delta-shl16) $lp }
    elseif($a.kind -eq 'drag'){ $from=Point-LParam $hwnd $f $a.fromX $a.fromY $space;$to=Point-LParam $hwnd $f $a.toX $a.toY $space;try{Send-Checked $hwnd 0x0201 1 $from;Send-Checked $hwnd 0x0200 1 $to}finally{Send-Checked $hwnd 0x0202 0 $to} }
    else{throw 'unsupported action'} }
  if([EmateWin32]::GetForegroundWindow() -ne $hwnd -and $channel-ne'accessibility'){throw 'foreground target changed during input'}
  return @{channel=$channel;activation=$activation;pointerInput=$pointer;pointerRouting=$routing;cleanupComplete=$true;targetVerified=$true;target=@{bundleId=$app.bundleId;pid=$app.pid;name=$app.name;executablePath=$app.executablePath;windowId=$request.window.id;processStartTime=$app.processStartTime;preStateHash=$request.expectedStateHash}}
}

try { $raw=[Console]::In.ReadToEnd(); if([Text.Encoding]::UTF8.GetByteCount($raw)-gt262144){throw 'request exceeds protocol limit'};$request=$raw|ConvertFrom-Json;if($request.protocolVersion-ne1){throw 'unsupported protocol version'};Assert-Interactive
  switch([string]$request.command){
    'health'{Reply-Ok (Get-Health)}
    'list-apps'{ $rows=@();foreach($h in Get-Windows){try{$a=Get-App $h;$rows+=,@{bundleId=$a.bundleId;pid=$a.pid;name=$a.name;executablePath=$a.executablePath;processStartTime=$a.processStartTime;windowId=$a.windowId;frontmost=([EmateWin32]::GetForegroundWindow()-eq$h);accessibility='granted';screenRecording='granted'};if($rows.Count-ge256){break}}catch{}};Reply-Ok $rows }
    'resolve-app'{Reply-Ok (Resolve-App $request.selector)}
    'observe'{Reply-Ok (Observe $request.app $request.options)}
    'act'{Reply-Ok (Act $request.request)}
    'release-input'{Reply-Ok (Release-Input $request.app $request.window $request.action)}
    default{throw 'unknown command'}
  }
} catch { $message=$_.Exception.Message;$code=if($message-match'stale|changed|replaced|moved|resized'){'COMPUTER_STALE_OBSERVATION'}elseif($message-match'locked|secure desktop|RDP|elevated|UIPI|authority|foreground|policy'){'COMPUTER_ACTION_BLOCKED'}else{'COMPUTER_PROVIDER_FAILURE'};Reply-Fail $code $message }
