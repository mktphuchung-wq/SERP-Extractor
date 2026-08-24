@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Auto SERP - Mo cua so Chrome automation

call "%~dp0_env.bat"

if not defined RUNTIME_READY (
  echo [i] Runtime chua day du - dang cai dat ...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
  if errorlevel 1 (
    echo [LOI] Cai dat that bai. Chay INSTALL.bat de xem chi tiet.
    echo.
    pause
    exit /b 2
  )
  call "%~dp0_env.bat"
)

if not defined NODE_EXE (
  echo [LOI] Khong tim thay Node.js. Chay INSTALL.bat truoc.
  echo.
  pause
  exit /b 2
)

"%NODE_EXE%" "scripts\open-chrome.mjs"
set "EXITCODE=%ERRORLEVEL%"

pause
exit /b %EXITCODE%
