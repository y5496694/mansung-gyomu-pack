@echo off
setlocal
set "NARAE_NODE=%~dp0runtime\node\node.exe"
if exist "%NARAE_NODE%" (
  "%NARAE_NODE%" "%~dp0src\cli.cjs" %*
) else (
  node "%~dp0src\cli.cjs" %*
)
exit /b %errorlevel%
