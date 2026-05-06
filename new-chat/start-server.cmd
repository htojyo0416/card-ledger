@echo off
setlocal
cd /d "C:\Users\h-toj\Documents\Codex\2026-05-06\new-chat"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found.
  echo Opening the app directly without the local server.
  start "" "%CD%\index.html"
  pause
  exit /b 1
)

echo Starting Card Ledger...
echo Keep this window open while using the app.
start "" "http://localhost:4173"
node server.js
pause
