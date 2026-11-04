@echo off
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-windows.ps1" %*
set "bridge_result=%errorlevel%"
pause
exit /b %bridge_result%
