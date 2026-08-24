@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Auto SERP Research Collector - Diagnose

call "%~dp0_env.bat"

if not defined NODE_EXE (
  echo [LOI] Khong tim thay Node.js. Chay INSTALL.bat truoc.
  echo.
  pause
  exit /b 2
)

if not exist "node_modules\playwright-core" (
  echo [i] Chua cai package - chay INSTALL.bat de cai day du runtime.
  echo.
  pause
  exit /b 2
)

"%NODE_EXE%" "src\cli.mjs" --diagnose
set "EXITCODE=%ERRORLEVEL%"

echo.
pause
exit /b %EXITCODE%
