@echo off
setlocal EnableExtensions
cd /d "%~dp0"

title Local Video Tiler

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found.
  echo Install it from https://nodejs.org/ then run this launcher again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo First launch: installing dependencies. This may take a minute...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron runtime is missing after install.
  pause
  exit /b 1
)

start "" "node_modules\electron\dist\electron.exe" .
exit /b 0
