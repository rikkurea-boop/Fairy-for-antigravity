@echo off
cd /d "%~dp0desktop-app"
start "" "node_modules\electron\dist\electron.exe" .
