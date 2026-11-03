@echo off
setlocal
if not exist "%~dp0node_modules\electron\dist\electron.exe" (
  echo Run the NaraeTalk installer first.
  exit /b 1
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0." --talk
