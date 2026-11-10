@echo off
rem Double-click this file on Windows to install Penny and open the setup wizard.
rem (Added after submission, v2.1.) It only touches this folder: a private .venv is made here, nothing system-wide.
cd /d "%~dp0"
echo Installing Penny. This takes about a minute the first time.
echo.
where py >nul 2>nul
if errorlevel 1 (
  echo Python is not installed. Get it at https://www.python.org/downloads/ and then double-click this file again.
  pause
  exit /b 1
)
py ap.py install
if errorlevel 1 (
  echo.
  echo The install did not finish. Read the message above.
  pause
  exit /b 1
)
echo.
call penny.bat setup
pause
