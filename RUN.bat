@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Auto SERP Research Collector

rem Phat hien double-click de giu cua so lai sau khi chay xong
set "KEEPOPEN="
echo %cmdcmdline% | find /i "%~nx0" >nul 2>&1
if not errorlevel 1 set "KEEPOPEN=1"

echo.
echo ============================================================
echo   AUTO SERP RESEARCH COLLECTOR
echo ============================================================
echo.
echo   Meo: nhap nhieu tu khoa ngan cach bang dau ";" de tao
echo        nhieu thu muc ket qua trong mot lan chay.
echo        Vi du:  Filipino vs Samoan; Samoan Food Guide
echo.

call "%~dp0_env.bat"

rem --- 1. Runtime ------------------------------------------------------------
rem Node portable, Chrome for Testing va node_modules deu do INSTALL.bat tai ve.
rem Neu con thieu thi tu chay lai buoc do thay vi bat nguoi dung tu mo file khac.
if not defined RUNTIME_READY (
  echo [i] Runtime chua day du - dang cai dat ...
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
  if errorlevel 1 (
    echo.
    echo [LOI] Cai dat that bai. Chay INSTALL.bat de xem chi tiet.
    set "EXITCODE=2"
    goto :done
  )
  call "%~dp0_env.bat"
)

if not defined NODE_EXE (
  echo [LOI] Khong tim thay Node.js va cung khong cai duoc ban portable.
  echo       Chay INSTALL.bat de xem loi chi tiet.
  set "EXITCODE=1"
  goto :done
)

rem --- 2. Chay ---------------------------------------------------------------
"%NODE_EXE%" "src\cli.mjs" %*
set "EXITCODE=%ERRORLEVEL%"

:done
echo.
if "%EXITCODE%"=="0" goto :msg_ok
if "%EXITCODE%"=="1" echo [1] Input hoac cau hinh khong hop le.
if "%EXITCODE%"=="2" echo [2] Loi Chrome / profile / extension. Chay DIAGNOSE.bat de kiem tra.
if "%EXITCODE%"=="3" echo [3] Google yeu cau consent hoac dang nhap. Chay OPEN_CHROME.bat, dang nhap roi chay lai.
if "%EXITCODE%"=="4" echo [4] Google yeu cau xac minh CAPTCHA. Xu ly tay trong Chrome roi chay lai.
if "%EXITCODE%"=="5" echo [5] Loi thu thap AI Mode.
if "%EXITCODE%"=="6" echo [6] Loi trich xuat SERP hoac tai CSV.
if "%EXITCODE%"=="7" echo [7] Ket qua khong qua duoc buoc kiem tra chat luong.
if "%EXITCODE%"=="8" echo [8] Loi khong xac dinh. Xem thu muc logs\
goto :end

:msg_ok
echo Hoan thanh. Xem thu muc output\

:end
if defined KEEPOPEN (
  echo.
  pause
)
exit /b %EXITCODE%
