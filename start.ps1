$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path -LiteralPath ".venv\Scripts\python.exe")) {
    python -m venv .venv
}

& ".venv\Scripts\python.exe" -m pip install -r requirements.lock
& ".venv\Scripts\python.exe" -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
