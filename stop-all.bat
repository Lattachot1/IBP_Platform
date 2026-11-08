@echo off
setlocal
cd /d "%~dp0"
title IBP Platform stopper

REM Stop the dev servers started by start-all.bat, then the database.
REM Data stays in the Docker volume - nothing is deleted.

echo Stopping the backend and frontend windows...
taskkill /fi "WINDOWTITLE eq IBP backend*" /t >nul 2>&1
taskkill /fi "WINDOWTITLE eq IBP frontend*" /t >nul 2>&1

echo Stopping the database containers...
docker compose stop mssql db-init

echo Done. Data is kept. Run start-all.bat to come back.
pause
