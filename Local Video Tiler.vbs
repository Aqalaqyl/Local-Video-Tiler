' Double-click launcher for Windows (no console window).
' Runs Launch.bat from this folder so Electron starts the app.
Option Explicit

Dim shell, fso, root, bat, electronExe, cmd
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
bat = root & "\Launch.bat"
electronExe = root & "\node_modules\electron\dist\electron.exe"

shell.CurrentDirectory = root

If fso.FileExists(electronExe) Then
  shell.Run """" & electronExe & """ .", 1, False
ElseIf fso.FileExists(bat) Then
  ' First run installs deps via Launch.bat (shows a console for progress).
  shell.Run "cmd /c """ & bat & """", 1, False
Else
  MsgBox "Launch.bat was not found next to this launcher.", vbCritical, "Local Video Tiler"
End If
