@echo off
setlocal
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Codex Theme Studio requires Node.js 22 or later.
  pause
  exit /b 1
)

node.exe "%~dp0theme.mjs" web
if not errorlevel 1 exit /b 0

echo.
echo Codex may already be running without Theme Studio enabled.
choice /C YN /N /M "Allow one graceful Codex restart? [Y/N] "
if errorlevel 2 exit /b 1
node.exe "%~dp0theme.mjs" web --restart-existing
if not errorlevel 1 exit /b 0

echo.
echo Unable to open Codex Theme Studio.
pause
exit /b 1
