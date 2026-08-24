@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Auto SERP Research Collector - Tests

call "%~dp0_env.bat"

if not defined NODE_EXE (
  echo [LOI] Khong tim thay Node.js. Chay INSTALL.bat truoc.
  echo.
  pause
  exit /b 2
)

if not exist "node_modules\linkedom" (
  echo [i] Dang cai package dev ...
  if defined NPM_CLI (
    "%NODE_EXE%" "%NPM_CLI%" install --no-audit --no-fund
  ) else (
    call npm install --no-audit --no-fund
  )
)

echo.
echo === UNIT TEST + INTEGRATION TEST ===
echo.
"%NODE_EXE%" --test "tests/**/*.test.mjs"
set "EXITCODE=%ERRORLEVEL%"

echo.
pause
exit /b %EXITCODE%
