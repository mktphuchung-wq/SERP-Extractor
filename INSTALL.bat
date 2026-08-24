@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Auto SERP Research Collector - Cai dat

rem Cai dat tu ban da tai ve san (khong can mang GitHub, khong can Git).
rem install.ps1 tu nhan ra minh dang nam trong thu muc du an nen bo qua buoc clone.

echo.
echo ============================================================
echo   CAI DAT AUTO SERP RESEARCH COLLECTOR
echo ============================================================
echo.
echo   Se tai ve (chi mot lan, khoang 230 MB):
echo     - Node.js portable       -^> runtime\node\
echo     - Chrome for Testing     -^> runtime\chrome\
echo     - Package Node           -^> node_modules\
echo.
echo   May trang cung chay duoc: KHONG can cai truoc Git, Node hay Chrome.
echo   3 extension da nam san trong vendor\extensions\ - khong phai cai gi.
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
set "EXITCODE=%ERRORLEVEL%"

echo.
if "%EXITCODE%"=="0" (
  echo Cai dat hoan tat.
) else (
  echo [LOI] Cai dat that bai. Doc thong bao ben tren roi chay lai file nay.
)
echo.
pause
exit /b %EXITCODE%
