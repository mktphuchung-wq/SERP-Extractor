@echo off
rem ===========================================================================
rem  Tim Node va kiem tra runtime. Duoc CALL tu cac file .bat khac.
rem  Dat NODE_EXE va RUNTIME_READY roi tra ve; khong tu in loi de moi launcher
rem  tu quyet dinh nen bao gi cho nguoi dung.
rem ===========================================================================

set "NODE_EXE="
set "RUNTIME_READY="

rem 1. Uu tien Node portable trong runtime\ - moi may deu cung mot phien ban.
if exist "%~dp0runtime\node\node.exe" set "NODE_EXE=%~dp0runtime\node\node.exe"

rem 2. Chua cai portable thi tam dung Node he thong (du de chay INSTALL).
if not defined NODE_EXE (
  for /f "delims=" %%p in ('where node 2^>nul') do (
    if not defined NODE_EXE set "NODE_EXE=%%p"
  )
)

rem Runtime coi la san sang khi co du package + Chrome for Testing.
if exist "%~dp0node_modules\playwright-core" (
  if exist "%~dp0runtime\chrome\chrome-win64\chrome.exe" set "RUNTIME_READY=1"
)

exit /b 0
