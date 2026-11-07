@echo off
setlocal
cd /d "%~dp0"
title IBP Platform launcher

REM ============================================================
REM  UBE IBP Platform - start everything with one double-click
REM  1. Docker Desktop (if needed)  2. SQL Server + schema
REM  3. Seed missing products       4. Backend (8080) + Frontend (3000)
REM  Passwords come from .env (never commit that file).
REM ============================================================

if not exist .env (
  echo .env not found - copy .env.example to .env and set the passwords first.
  pause
  exit /b 1
)

REM --- read the passwords from .env ---
for /f "tokens=1,* delims==" %%a in ('findstr /b "IBP_APP_PASSWORD=" .env') do set "IBP_APP_PASSWORD=%%b"
for /f "tokens=1,* delims==" %%a in ('findstr /b "MSSQL_SA_PASSWORD=" .env') do set "MSSQL_SA_PASSWORD=%%b"
if "%IBP_APP_PASSWORD%"=="" (
  echo .env has no IBP_APP_PASSWORD line.
  pause
  exit /b 1
)
if "%MSSQL_SA_PASSWORD%"=="" (
  echo .env has no MSSQL_SA_PASSWORD line.
  pause
  exit /b 1
)
set "DATABASE_URL=sqlserver://ibp_app:%IBP_APP_PASSWORD%@localhost:1433?database=IBP_DB"

REM --- 1. make sure the Docker daemon is running ---
docker info >nul 2>&1
if errorlevel 1 (
  echo Starting Docker Desktop - first start can take a minute...
  start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  set /a tries=0
  :waitdocker
  timeout /t 3 /nobreak >nul
  docker info >nul 2>&1
  if errorlevel 1 (
    set /a tries+=1
    if %tries% lss 60 goto waitdocker
    echo Docker did not start in time. Open Docker Desktop manually, then run this file again.
    pause
    exit /b 1
  )
)
echo [1/4] Docker is ready.

REM --- 2. start only the database + one-shot schema init ---
REM      (the compose backend/frontend containers stay off so the
REM       local dev servers can use ports 8080 / 3000)
docker compose up -d mssql db-init
if errorlevel 1 (
  echo docker compose failed - check the error above.
  pause
  exit /b 1
)
echo [2/4] Waiting for SQL Server to accept connections...
set /a tries=0
:waitdb
timeout /t 5 /nobreak >nul
docker exec ube-ibp-mssql /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "%MSSQL_SA_PASSWORD%" -C -Q "SELECT 1" >nul 2>&1
if errorlevel 1 (
  set /a tries+=1
  if %tries% lss 60 goto waitdb
  echo SQL Server did not become ready in time - see docker logs ube-ibp-mssql
  pause
  exit /b 1
)
echo [3/4] Database is ready - adding any missing products (idempotent)...
pushd Backend
python -m planning_data.seed --source mock
popd

REM --- 4. backend and frontend, each in its own window ---
REM      the backend inherits DATABASE_URL from this console; its
REM      forecast training at startup takes about 15 minutes
start "IBP backend (8080)" cmd /k "cd /d "%~dp0Backend" && python main.py"
start "IBP frontend (3000)" cmd /k "cd /d "%~dp0Frontend" && npm run dev"
echo [4/4] Backend and frontend are starting in their own windows.

timeout /t 10 /nobreak >nul
start http://localhost:3000
echo.
echo All started. Backend health: http://localhost:8080/api/health
echo The forecast trains for about 15 minutes at backend startup -
echo other pages work meanwhile, the forecast fills in when it is done.
echo Close this window or press a key when you have read this.
pause
