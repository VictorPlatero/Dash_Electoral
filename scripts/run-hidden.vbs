' Lanza Node sin abrir ninguna ventana de consola y devuelve su codigo de salida
' al Programador de tareas. Uso: wscript.exe run-hidden.vbs "C:\ruta\node.exe" script.mjs [args...]
Option Explicit
Dim shell, fso, args, i, command, nodePath
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set args = WScript.Arguments
If args.Count < 2 Then WScript.Quit 2

nodePath = args(0)
' Si el Node configurado desaparecio (desinstalado o movido), se intenta el instalado en el sistema.
If Not fso.FileExists(nodePath) Then nodePath = shell.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
If Not fso.FileExists(nodePath) Then WScript.Quit 3

' Directorio de trabajo: la raiz del proyecto (carpeta padre de scripts\).
shell.CurrentDirectory = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))

command = """" & nodePath & """"
For i = 1 To args.Count - 1
    command = command & " """ & args(i) & """"
Next
WScript.Quit shell.Run(command, 0, True)
