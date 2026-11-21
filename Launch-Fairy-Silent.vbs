Set fso = CreateObject("Scripting.FileSystemObject")
rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
tauriExe = fso.BuildPath(rootDir, "desktop-app-tauri\src-tauri\target\release\fairy-desktop.exe")
appDir = fso.BuildPath(rootDir, "desktop-app")
electronExe = fso.BuildPath(appDir, "node_modules\electron\dist\electron.exe")

Set WshShell = CreateObject("WScript.Shell")
If fso.FileExists(tauriExe) Then
  WshShell.CurrentDirectory = rootDir
  WshShell.Run """" & tauriExe & """", 1, False
Else
  WshShell.CurrentDirectory = appDir
  WshShell.Run """" & electronExe & """ """ & appDir & """", 1, False
End If
