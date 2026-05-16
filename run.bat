@echo off
cd /d "%~dp0"
echo Starting Urdu Voice to Text (browser mode)...
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
