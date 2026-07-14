' Double-click installer/launcher for Windows (no console when already installed).
Option Explicit

Dim shell, fso, root, installExe, builderExe, launcherExe, bat
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root

installExe = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Local Video Tiler\Local Video Tiler.exe"
builderExe = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\Local Video Tiler\Local Video Tiler.exe"
launcherExe = root & "\Local Video Tiler.exe"
distLauncherExe = root & "\dist\Local Video Tiler.exe"
bat = root & "\Launch.bat"

If fso.FileExists(installExe) Then
  shell.Run """" & installExe & """", 1, False
ElseIf fso.FileExists(builderExe) Then
  shell.Run """" & builderExe & """", 1, False
ElseIf fso.FileExists(launcherExe) Then
  ' First-time install may show a console from the installer/launcher.
  shell.Run """" & launcherExe & """", 1, False
ElseIf fso.FileExists(distLauncherExe) Then
  shell.Run """" & distLauncherExe & """", 1, False
ElseIf fso.FileExists(bat) Then
  shell.Run "cmd /c """ & bat & """", 1, False
Else
  MsgBox "Local Video Tiler launcher files were not found.", vbCritical, "Local Video Tiler"
End If
