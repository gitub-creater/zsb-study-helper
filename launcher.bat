@echo off
title ZSB Study Helper

:: Project directory (auto-detect: script folder, fallback to default)
set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
if not exist "%PROJECT_DIR%\server.cjs" (
    set "PROJECT_DIR=C:\Users\%USERNAME%\.zcode\workspace\default\zsb-study-helper"
)
if not exist "%PROJECT_DIR%\server.cjs" (
    echo ERROR: Project directory not found!
    pause
    exit /b 1
)

:: Check if server is already running on port 5173
set "ALREADY_RUNNING="
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":5173 " ^| findstr "LISTENING"') do set "ALREADY_RUNNING=%%a"

if defined ALREADY_RUNNING (
    echo Server already running, opening app...
) else (
    echo Starting ZSB Study Helper server...
    cd /d "%PROJECT_DIR%"
    start /min "" node "%PROJECT_DIR%\server.cjs"
    echo Waiting for server to start...
    timeout /t 2 /nobreak >nul 2>&1
)

:: Find Chrome or Edge for app-mode window
set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
) else if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    set "BROWSER=%LocalAppData%\Google\Chrome\Application\chrome.exe"
) else if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
) else if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
)

if defined BROWSER (
    start "" "%BROWSER%" --app=http://localhost:5173/?desktop=20260829 --window-size=1280,860 --window-position=60,30
) else (
    start http://localhost:5173/?desktop=20260829
)

exit
