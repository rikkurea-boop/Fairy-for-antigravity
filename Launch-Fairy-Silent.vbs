Set fso = CreateObject("Scripting.FileSystemObject")
rootDir = fso.GetParentFolderName(WScript.ScriptFullName)
appDir = fso.BuildPath(rootDir, "desktop-app")
electronExe = fso.BuildPath(appDir, "node_modules\electron\dist\electron.exe")

Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = appDir
WshShell.Run """" & electronExe & """ """ & appDir & """", 1, False
