@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

title Local Video Tiler

set "PRODUCT=Local Video Tiler"
set "INSTALL_DIR=%LOCALAPPDATA%\%PRODUCT%"
set "INSTALL_EXE=%INSTALL_DIR%\%PRODUCT%.exe"
set "BUILDER_EXE=%LOCALAPPDATA%\Programs\%PRODUCT%\%PRODUCT%.exe"

REM Already installed → launch
if exist "%INSTALL_EXE%" (
  start "" "%INSTALL_EXE%"
  exit /b 0
)
if exist "%BUILDER_EXE%" (
  start "" "%BUILDER_EXE%"
  exit /b 0
)

REM Prefer the smart installer/launcher exe when present
if exist "%~dp0%PRODUCT%.exe" (
  start "" "%~dp0%PRODUCT%.exe"
  exit /b 0
)
if exist "%~dp0dist\%PRODUCT%.exe" (
  start "" "%~dp0dist\%PRODUCT%.exe"
  exit /b 0
)

REM First-time install from a nearby electron-builder unpack
set "UNPACKED="
if exist "%~dp0dist\win-unpacked\%PRODUCT%.exe" set "UNPACKED=%~dp0dist\win-unpacked"
if not defined UNPACKED if exist "%~dp0win-unpacked\%PRODUCT%.exe" set "UNPACKED=%~dp0win-unpacked"

if defined UNPACKED (
  echo Installing %PRODUCT%...
  if exist "%INSTALL_DIR%" rmdir /s /q "%INSTALL_DIR%" 2>nul
  mkdir "%INSTALL_DIR%" 2>nul
  xcopy /E /I /Y /Q "%UNPACKED%\*" "%INSTALL_DIR%\" >nul
  if not exist "%INSTALL_EXE%" (
    echo Install failed: application executable not found after copy.
    pause
    exit /b 1
  )
  call :create_shortcuts "%INSTALL_EXE%" "%INSTALL_DIR%"
  echo.
  echo Installed to: %INSTALL_DIR%
  start "" "%INSTALL_EXE%"
  exit /b 0
)

REM Source-tree install: need Node.js + npm once
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is required for the first-time install.
  echo Install the LTS build from https://nodejs.org/ then run this again.
  echo.
  pause
  exit /b 1
)

if not exist "main.js" (
  echo Could not find application files to install.
  echo Place this folder next to dist\win-unpacked or the project source.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing prerequisites ^(npm install^). This may take a minute...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo npm install failed.
    pause
    exit /b 1
  )
)

echo Building the installer/launcher. Please wait...
call npm run launcher:win
if errorlevel 1 (
  echo.
  echo Could not build %PRODUCT%.exe — launching from this folder instead.
  start "" "node_modules\electron\dist\electron.exe" .
  exit /b 0
)

start "" "%~dp0%PRODUCT%.exe"
exit /b 0

:create_shortcuts
set "TARGET=%~1"
set "WORKDIR=%~2"
set "PROGRAMS=%APPDATA%\Microsoft\Windows\Start Menu\Programs"
if not exist "%PROGRAMS%" mkdir "%PROGRAMS%" 2>nul
powershell -NoProfile -Command ^
  "$ws=New-Object -ComObject WScript.Shell; $s=$ws.CreateShortcut('%PROGRAMS%\%PRODUCT%.lnk'); $s.TargetPath='%TARGET%'; $s.WorkingDirectory='%WORKDIR%'; $s.IconLocation='%TARGET%'; $s.Save(); $desk=[Environment]::GetFolderPath('Desktop'); $s=$ws.CreateShortcut(($desk + '\%PRODUCT%.lnk')); $s.TargetPath='%TARGET%'; $s.WorkingDirectory='%WORKDIR%'; $s.IconLocation='%TARGET%'; $s.Save()" >nul 2>&1
exit /b 0
