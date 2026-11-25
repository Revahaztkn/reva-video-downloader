@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0yardimci\Kur.ps1"
set "RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %RESULT%
