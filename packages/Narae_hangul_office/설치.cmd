@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install.ps1"
if errorlevel 1 (
  echo.
  echo 설치 중 오류가 발생했습니다. 위의 안내를 확인해 주세요.
)
pause
