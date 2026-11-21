@echo off
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*fairy-zzz-antigravity*desktop-app*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
