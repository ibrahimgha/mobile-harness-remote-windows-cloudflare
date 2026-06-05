Option Explicit

Dim fso
Dim shell
Dim scriptDir
Dim servicePath
Dim command

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
servicePath = fso.BuildPath(scriptDir, "service.ps1")
command = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File " & Chr(34) & servicePath & Chr(34) & " watchdog"

shell.Run command, 0, False
WScript.Quit 0
