@echo off
reg.exe add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "FairyIII_HDD_Intro" /t REG_SZ /d "\"%~dp0desktop-app\node_modules\electron\dist\electron.exe\" \"%~dp0desktop-app\"" /f >nul
if exist "%~dp0scripts\setup-desktop-and-startup.ps1" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "try { Enable-ScheduledTask -TaskName 'FairyIII_HDD_BootIntro' -ErrorAction SilentlyContinue | Out-Null } catch {}"
)
echo [Fairy III] Da bat Intro khoi dong cung Windows.
pause
