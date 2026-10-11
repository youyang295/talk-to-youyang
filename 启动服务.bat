@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==================================================
echo   About sly - local server
echo   Website + the three message boards.
echo   All messages are saved to the data file printed below.
echo ==================================================
echo.

set "NODE=node"
where node >nul 2>nul
if errorlevel 1 set "NODE=C:\Users\16230\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

"%NODE%" "%~dp0dev\server.js"
set "RC=%ERRORLEVEL%"

echo.
if not "%RC%"=="0" echo   Server exited with code %RC%.
echo   Press any key to close this window.
pause >nul
exit /b %RC%