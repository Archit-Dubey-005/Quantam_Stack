@echo off
echo.
echo ========================================
echo   SOLAR POWER PREDICTION PLATFORM
echo ========================================
echo.
echo Starting the platform...
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if Python is installed
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python from https://python.org/
    pause
    exit /b 1
)

REM Install dependencies if needed
if not exist node_modules (
    echo Installing Node.js dependencies...
    npm install
    echo.
)

REM Start the server
echo Starting backend server...
echo Server will be available at: http://localhost:3001
echo.
echo Press Ctrl+C to stop the server
echo.

node server.js
