@echo off
chcp 65001 >nul
if exist "%~dp0node_modules\electron\dist\electron.exe" (
  start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
) else if exist "%LOCALAPPDATA%\Programs\NaraeHangulOffice\나래 한글 오피스.vbs" (
  wscript.exe "%LOCALAPPDATA%\Programs\NaraeHangulOffice\나래 한글 오피스.vbs"
) else (
  echo 설치.cmd를 먼저 실행하세요.
  pause
)
