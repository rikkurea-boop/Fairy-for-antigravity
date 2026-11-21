@echo off
set "TAURI_EXE=%~dp0desktop-app-tauri\src-tauri\target\release\fairy-desktop.exe"
if exist "%TAURI_EXE%" (
  start "" "%TAURI_EXE%" %*
  exit /b 0
)
cd /d "%~dp0desktop-app"
start "" "node_modules\electron\dist\electron.exe" . %*
