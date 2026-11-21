$ErrorActionPreference = 'Stop'

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$DesktopAppDir = Join-Path $RepoRoot 'desktop-app'
$ElectronExe = Join-Path $DesktopAppDir 'node_modules\electron\dist\electron.exe'
$TauriExe = Join-Path $RepoRoot 'desktop-app-tauri\src-tauri\target\release\fairy-desktop.exe'
$UseTauri = Test-Path $TauriExe
$LaunchTarget = if ($UseTauri) { $TauriExe } else { $ElectronExe }
$LaunchArgs = if ($UseTauri) { '' } else { "`"$DesktopAppDir`"" }
$LaunchWorkDir = if ($UseTauri) { $RepoRoot } else { $DesktopAppDir }
$SourcePng = Join-Path $RepoRoot 'antigravity-plugin\assets\icon-180.png'
$IcoPath = Join-Path $DesktopAppDir 'fairy.ico'

if (-not (Test-Path $LaunchTarget)) {
  throw "Missing desktop executable at $LaunchTarget"
}
if (-not (Test-Path $SourcePng)) {
  throw "Missing source PNG icon at $SourcePng"
}

# 1. Generate multi-resolution Windows .ico (PNG frames inside ICO container)
Add-Type -AssemblyName System.Drawing
$srcImage = [System.Drawing.Image]::FromFile($SourcePng)
try {
  $sizes = @(16, 32, 48, 64, 256)
  $frames = New-Object System.Collections.Generic.List[object]

  foreach ($sz in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap($sz, $sz, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.DrawImage($srcImage, 0, 0, $sz, $sz)
      } finally {
        $g.Dispose()
      }
      $ms = New-Object System.IO.MemoryStream
      $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
      $frames.Add([PSCustomObject]@{
        Size = $sz
        Bytes = $ms.ToArray()
      })
      $ms.Dispose()
    } finally {
      $bmp.Dispose()
    }
  }
} finally {
  $srcImage.Dispose()
}

$fs = New-Object System.IO.FileStream($IcoPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
try {
  $bw = New-Object System.IO.BinaryWriter($fs)
  try {
    # ICONDIR header (6 bytes)
    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]$frames.Count)

    $offset = [uint32](6 + (16 * $frames.Count))
    foreach ($f in $frames) {
      $dimByte = if ($f.Size -ge 256) { [byte]0 } else { [byte]$f.Size }
      $bw.Write($dimByte)                 # bWidth
      $bw.Write($dimByte)                 # bHeight
      $bw.Write([byte]0)                  # bColorCount
      $bw.Write([byte]0)                  # bReserved
      $bw.Write([uint16]1)                # wPlanes
      $bw.Write([uint16]32)               # wBitCount
      $bw.Write([uint32]$f.Bytes.Length)  # dwBytesInRes
      $bw.Write($offset)                  # dwImageOffset
      $offset += [uint32]$f.Bytes.Length
    }
    foreach ($f in $frames) {
      $bw.Write($f.Bytes)
    }
  } finally {
    $bw.Dispose()
  }
} finally {
  $fs.Dispose()
}

# 2. Create Silent VBS launcher (zero CMD window flash, prefers Tauri fast-boot binary when built)
$VbsPath = Join-Path $RepoRoot 'Launch-Fairy-Silent.vbs'
$vbsContent = @(
  'Set fso = CreateObject("Scripting.FileSystemObject")'
  'rootDir = fso.GetParentFolderName(WScript.ScriptFullName)'
  'tauriExe = fso.BuildPath(rootDir, "desktop-app-tauri\src-tauri\target\release\fairy-desktop.exe")'
  'appDir = fso.BuildPath(rootDir, "desktop-app")'
  'electronExe = fso.BuildPath(appDir, "node_modules\electron\dist\electron.exe")'
  'Set WshShell = CreateObject("WScript.Shell")'
  'If fso.FileExists(tauriExe) Then'
  '  WshShell.CurrentDirectory = rootDir'
  '  WshShell.Run """" & tauriExe & """", 1, False'
  'Else'
  '  WshShell.CurrentDirectory = appDir'
  '  WshShell.Run """" & electronExe & """ """ & appDir & """", 1, False'
  'End If'
) -join "`r`n"
[System.IO.File]::WriteAllText($VbsPath, $vbsContent + "`r`n", [System.Text.Encoding]::ASCII)

# 3. Create Enable/Disable Startup Intro batch helpers
$EnableBatPath = Join-Path $RepoRoot 'Enable-Startup-Intro.bat'
$DisableBatPath = Join-Path $RepoRoot 'Disable-Startup-Intro.bat'
$RunKey = 'HKCU\Software\Microsoft\Windows\CurrentVersion\Run'
$RunValueName = 'FairyIII_HDD_Intro'
$TaskName = 'FairyIII_HDD_BootIntro'

$enableBat = @"
@echo off
set "TAURI_EXE=%~dp0desktop-app-tauri\src-tauri\target\release\fairy-desktop.exe"
if exist "%TAURI_EXE%" (
  reg.exe add "$RunKey" /v "$RunValueName" /t REG_SZ /d "\"%TAURI_EXE%\"" /f >nul
) else (
  reg.exe add "$RunKey" /v "$RunValueName" /t REG_SZ /d "\"$ElectronExe\" \"$DesktopAppDir\"" /f >nul
)
if exist "%~dp0scripts\setup-desktop-and-startup.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Enable-ScheduledTask -TaskName '$TaskName' -ErrorAction SilentlyContinue | Out-Null } catch {}"
)
echo [Fairy III] Da bat Intro khoi dong cung Windows.
pause
"@
[System.IO.File]::WriteAllText($EnableBatPath, $enableBat, [System.Text.Encoding]::ASCII)

$disableBat = @"
@echo off
reg.exe delete "$RunKey" /v "$RunValueName" /f >nul 2>&1
schtasks.exe /Delete /TN "$TaskName" /F >nul 2>&1
echo [Fairy III] Da tat Intro khoi dong cung Windows.
pause
"@
[System.IO.File]::WriteAllText($DisableBatPath, $disableBat, [System.Text.Encoding]::ASCII)

# 4. Create Clickable Desktop Shortcut & Start Menu Shortcut
$WshShell = New-Object -ComObject WScript.Shell
$DesktopDir = [Environment]::GetFolderPath('Desktop')
$StartMenuPrograms = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$ShortcutName = 'Fairy III H.D.D.lnk'
$ShortcutTargets = @(
  (Join-Path $DesktopDir $ShortcutName),
  (Join-Path $StartMenuPrograms $ShortcutName)
)

$descDot = [char]0x00B7
$appDesc = "Fairy III $descDot H.D.D Terminal Overlay (Antigravity)"

foreach ($lnkPath in $ShortcutTargets) {
  $parentDir = Split-Path -Parent $lnkPath
  if (-not (Test-Path $parentDir)) {
    New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
  }
  $sc = $WshShell.CreateShortcut($lnkPath)
  $sc.TargetPath = $LaunchTarget
  $sc.Arguments = $LaunchArgs
  $sc.WorkingDirectory = $LaunchWorkDir
  $sc.IconLocation = "$IcoPath,0"
  $sc.WindowStyle = 1
  $sc.Description = $appDesc
  $sc.Save()
}

# 5. Register Early Windows Logon Startup (HKCU Run + Scheduled Task fallback)
$PsRunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if (-not (Test-Path $PsRunKey)) {
  New-Item -Path $PsRunKey -Force | Out-Null
}
$regCmd = if ($UseTauri) { "`"$LaunchTarget`"" } else { "`"$LaunchTarget`" $LaunchArgs" }
Set-ItemProperty -Path $PsRunKey -Name $RunValueName -Value $regCmd -Type String

$taskStatus = 'skipped'
try {
  $currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
  $action = if ($LaunchArgs) {
    New-ScheduledTaskAction -Execute $LaunchTarget -Argument $LaunchArgs -WorkingDirectory $LaunchWorkDir
  } else {
    New-ScheduledTaskAction -Execute $LaunchTarget -WorkingDirectory $LaunchWorkDir
  }
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
  $principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -Priority 4 `
    -MultipleInstances IgnoreNew
  Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Principal $principal `
    -Settings $settings `
    -Description $appDesc `
    -Force | Out-Null
  $taskStatus = "registered ($currentUser)"
} catch {
  $taskStatus = "unavailable ($($_.Exception.Message))"
}

Write-Output "ICO_CREATED=$IcoPath ($((Get-Item $IcoPath).Length) bytes)"
Write-Output "VBS_CREATED=$VbsPath"
Write-Output "DESKTOP_LNK=$(Join-Path $DesktopDir $ShortcutName)"
Write-Output "STARTMENU_LNK=$(Join-Path $StartMenuPrograms $ShortcutName)"
Write-Output "REGISTRY_RUN=$((Get-ItemProperty -Path $PsRunKey -Name $RunValueName).$RunValueName)"
Write-Output "SCHEDULED_TASK=$taskStatus"
