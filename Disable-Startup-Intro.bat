@echo off
reg.exe delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "FairyIII_HDD_Intro" /f >nul 2>&1
schtasks.exe /Delete /TN "FairyIII_HDD_BootIntro" /F >nul 2>&1
echo [Fairy III] Da tat Intro khoi dong cung Windows.
pause