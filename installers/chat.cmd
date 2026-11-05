@echo off
set "BRIDGE_DATA=%USERPROFILE%\.computer-bridge"
if defined COMPUTER_BRIDGE_HOME set "BRIDGE_DATA=%COMPUTER_BRIDGE_HOME%"
set /p BRIDGE_PYTHON=<"%BRIDGE_DATA%\launcher-python.txt"
"%BRIDGE_PYTHON%" "%BRIDGE_DATA%\launcher.py" --home "%BRIDGE_DATA%" --command chat %*
exit /b %errorlevel%
