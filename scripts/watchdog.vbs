Option Explicit

Dim fso
Dim shell
Dim scriptDir
Dim servicePath
Dim command

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
servicePath = fso.BuildPath(fso.GetParentFolderName(scriptDir), ".runtime\watchdog-launcher.exe")
command = Chr(34) & servicePath & Chr(34)

WScript.Quit shell.Run(command, 0, True)
