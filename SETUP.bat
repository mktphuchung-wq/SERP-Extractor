@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Auto SERP Research Collector - Cai dat

rem Giu lai ten cu cho quen tay. Toan bo viec cai dat nam trong INSTALL.bat.
echo.
echo   SETUP.bat da duoc thay bang INSTALL.bat.
echo   Dang chuyen tiep sang INSTALL.bat ...
echo.
call "%~dp0INSTALL.bat"
exit /b %ERRORLEVEL%
