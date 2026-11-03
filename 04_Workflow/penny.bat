@echo off
if exist "%~dp0.venv\Scripts\python.exe" (
  "%~dp0.venv\Scripts\python.exe" "%~dp0ap.py" %*
) else (
  py "%~dp0ap.py" %*
)
