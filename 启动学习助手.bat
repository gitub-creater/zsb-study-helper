@echo off
chcp 65001 >nul 2>&1
title 专升本学习助手

:: 项目目录(根据实际位置自动检测)
set "PROJECT_DIR=%~dp0"
set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

:: 如果 .bat 在桌面上,则切换到项目目录
if not exist "%PROJECT_DIR%\package.json" (
    set "PROJECT_DIR=C:\Users\丁辉\.zcode\workspace\default\zsb-study-helper"
)

:: 检查端口是否已占用(服务是否已在运行)
set "PORT_CHECK="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173 " ^| findstr "LISTENING" 2^>nul') do set "PORT_CHECK=%%a"

if defined PORT_CHECK (
    echo 服务已在运行中,直接打开应用...
) else (
    echo 正在启动学习助手服务...
    cd /d "%PROJECT_DIR%"
    start /min cmd /c "npm run dev > nul 2>&1"
    echo 等待服务启动...
    timeout /t 4 /nobreak >nul
)

:: 查找浏览器(优先 Chrome,其次 Edge)
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
    echo 以应用模式打开浏览器...
    start "" "%BROWSER%" --app=http://localhost:5173 --window-size=1280,860 --window-position=80,40
) else (
    echo 未找到 Chrome 或 Edge,使用默认浏览器打开...
    start http://localhost:5173
)

echo 专升本学习助手已启动!
timeout /t 2 /nobreak >nul
exit
