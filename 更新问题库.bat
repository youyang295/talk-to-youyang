@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==========================================
echo   Update question bank
echo   wen ti ku\*.txt  --^>  assets\question-bank.js
echo ==========================================
echo.

set "NODE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE=C:\Users\16230\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

"%NODE%" "%~dp0dev\build-bank.js"
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" echo   [FAILED] ti liang bu gou huo ge shi you wen ti, jian shang mian.
echo.
pause
exit /b %RC%