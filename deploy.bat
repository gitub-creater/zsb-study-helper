@echo off
chcp 65001 >nul 2>&1
title Deploy ZSB Study Helper

echo ============================================
echo   ZSB Study Helper - Deploy Script
echo ============================================
echo.
echo Choose deployment method:
echo.
echo   1. GitHub Pages  (requires GitHub account + token)
echo   2. Vercel        (requires Vercel account)
echo   3. Netlify       (requires Netlify account)
echo.
set /p choice="Enter choice (1/2/3): "

if "%choice%"=="1" goto github
if "%choice%"=="2" goto vercel
if "%choice%"=="3" goto netlify
echo Invalid choice.
pause
exit /b

:github
echo.
echo --- GitHub Pages Deployment ---
echo.
set /p GH_USER="GitHub username: "
set /p GH_TOKEN="GitHub Personal Access Token (with repo scope): "

echo.
echo Creating repo and pushing...
curl -s -X POST -H "Authorization: token %GH_TOKEN%" -H "Content-Type: application/json" -d "{\"name\":\"zsb-study-helper\"}" https://api.github.com/user/repos >nul 2>&1

git remote add origin https://%GH_USER%:%GH_TOKEN%@github.com/%GH_USER%/zsb-study-helper.git 2>nul
git branch -M main
git push -u origin main --force

if %errorlevel% == 0 (
    echo.
    echo Push successful! Enabling GitHub Pages...
    curl -s -X POST -H "Authorization: token %GH_TOKEN%" -H "Content-Type: application/json" -d "{\"source\":{\"branch\":\"main\",\"path\":\"/\"}}" https://api.github.com/repos/%GH_USER%/zsb-study-helper/pages >nul 2>&1
    echo.
    echo ==========================================
    echo   Deploy complete!
    echo   URL: https://%GH_USER%.github.io/zsb-study-helper/
    echo   (Wait 1-2 minutes for first deployment)
    echo ==========================================
) else (
    echo Push failed. Check your username and token.
)
goto end

:vercel
echo.
echo --- Vercel Deployment ---
echo Installing Vercel CLI (one-time)...
call npx vercel --version >nul 2>&1
echo Deploying...
call npx vercel ./dist --prod --yes
goto end

:netlify
echo.
echo --- Netlify Deployment ---
echo Installing Netlify CLI (one-time)...
call npx netlify-cli --version >nul 2>&1
echo Deploying...
call npx netlify deploy --dir=dist --prod
goto end

:end
echo.
pause
