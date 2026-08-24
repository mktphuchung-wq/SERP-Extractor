@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Auto SERP Research Collector - Smoke Test

echo.
echo ============================================================
echo   SMOKE TEST - kiem tra selector va fallback
echo   Ket qua ghi vao thu muc TAM, khong dung output that.
echo ============================================================
echo.

call "%~dp0_env.bat"

if not defined NODE_EXE (
  echo [LOI] Khong tim thay Node.js. Chay INSTALL.bat truoc.
  echo.
  pause
  exit /b 2
)

"%NODE_EXE%" "src\smoke.mjs" %*
set "EXITCODE=%ERRORLEVEL%"

echo.
pause
exit /b %EXITCODE%
