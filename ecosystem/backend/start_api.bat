@echo off
REM Start My Ride FastAPI backend (local dev)
REM This batch file properly activates the virtual environment on Windows

cd /d "%~dp0"

REM Create .env if it doesn't exist
if not exist .env (
    copy .env.example .env >nul
    echo Created .env from .env.example
)

REM Activate the virtual environment
call .venv\Scripts\activate.bat

REM Run the server
python run.py