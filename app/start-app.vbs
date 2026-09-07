Set WinScriptHost = CreateObject("WScript.Shell")
WinScriptHost.CurrentDirectory = "C:\Users\steve\Development\paudio\app"
WinScriptHost.Run "cmd.exe /c npm run start", 0, False
