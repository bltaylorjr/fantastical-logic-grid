@echo off
setlocal EnableDelayedExpansion
title Set up Vox
cd /d "%~dp0"
rem Vox's own Python environment lives outside MEGA (it's a few gigabytes), so
rem it never syncs: %LocalAppData%\Vox\venv. Python 3.10 to 3.13 only: newer
rem ones (3.14, 3.15) are missing parts Vox needs (Whisper's audio decoder,
rem the base voices).
set "VOXHOME=%LocalAppData%\Vox"
set "VENV=%VOXHOME%\venv"
set "VPY=%VENV%\Scripts\python.exe"
set "VPYW=%VENV%\Scripts\pythonw.exe"
echo ============================================
echo   Setting up Vox, your free voice engine
echo ============================================
echo.

echo [1/7] Stopping Vox if it's running...
if exist "learning\vox.pid" (
  for /f "usebackq delims=" %%P in ("learning\vox.pid") do taskkill /PID %%P /F >nul 2>nul
  del "learning\vox.pid" >nul 2>nul
)
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /r /c:":5150 .*LISTENING"') do taskkill /PID %%P /F >nul 2>nul
echo.

echo [2/7] Finding Python 3.13 (or 3.12, 3.11, 3.10)...
call :findpy
if not defined PY (
  echo It isn't installed. Installing Python 3.13 now, free, from python.org.
  echo Any other Python on this computer stays exactly as it is.
  where winget >nul 2>nul
  if errorlevel 1 (
    echo This computer can't install it automatically. Get Python 3.13 from
    echo https://www.python.org/downloads/ , install it, then run this file again.
    start "" https://www.python.org/downloads/
    pause
    exit /b 1
  )
  winget install -e --id Python.Python.3.13 --scope user --silent --accept-package-agreements --accept-source-agreements
  call :findpy
)
if not defined PY (
  echo.
  echo Python 3.13 didn't install. Copy the messages above and ask Claude for help.
  pause
  exit /b 1
)
"%PY%" --version
echo.

echo [3/7] Vox's own Python environment...
if exist "%VPY%" (
  "%VPY%" -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,13) else 1)" >nul 2>nul
  if errorlevel 1 (
    echo It was made with a Python that's too new. Making it again.
    rmdir /s /q "%VENV%"
  )
)
if not exist "%VPY%" (
  if not exist "%VOXHOME%" mkdir "%VOXHOME%"
  "%PY%" -m venv "%VENV%"
)
if not exist "%VPY%" (
  echo Making Vox's Python environment didn't work. Copy the messages above and ask Claude for help.
  pause
  exit /b 1
)
echo.

echo [4/7] Installing what Vox needs. The first time this downloads free parts
echo       (PyTorch is the biggest), so allow 5 to 15 minutes...
"%VPY%" -m pip install --upgrade pip --disable-pip-version-check -q
"%VPY%" -m pip install --disable-pip-version-check -r requirements.txt
"%VPY%" -m pip install --disable-pip-version-check -q --no-deps -e .
"%VPY%" -c "import vox.cli, torch, fastapi, uvicorn" >nul 2>nul
if errorlevel 1 (
  echo.
  echo The install did not finish. Copy the error above and ask Claude for help.
  pause
  exit /b 1
)
echo.

echo [5/7] Installing Whisper, which checks how clearly each line is said...
"%VPY%" -m pip install --disable-pip-version-check -q faster-whisper
"%VPY%" -c "from faster_whisper import WhisperModel; WhisperModel('base', compute_type='int8'); print('Whisper is ready.')"
if errorlevel 1 echo Whisper didn't install. Vox still works without it; the Voice engine page can try again.
echo.

echo [6/7] Getting the base voices (real speech while Vox's own model learns; about 150 MB)...
"%VPY%" -m vox.base --root "%CD%"
if errorlevel 1 echo The base voices didn't install. Vox tries again by itself when it starts.
if not exist "practice.pt" "%VPY%" -m vox.cli init --preset tiny --out practice.pt
echo.

echo [7/7] Shortcuts, and starting Vox...
rem Vox and Stop Vox on the desktop, and Vox in the Startup folder so it starts
rem quietly (no window) every time you sign in. The Voice engine page connects
rem to it by itself.
"%VPY%" -m vox.background --shortcuts
start "" "%VPYW%" -m vox.background
echo.
echo Done. Vox is starting now and will start by itself whenever you sign in.
echo The Voice engine page opens when it's ready (the first start takes a minute).
echo This window can be closed.
timeout /t 15 >nul
exit /b 0

:findpy
set "PY="
for %%V in (313 312 311 310) do (
  if not defined PY if exist "%LocalAppData%\Programs\Python\Python%%V\python.exe" set "PY=%LocalAppData%\Programs\Python\Python%%V\python.exe"
  if not defined PY if exist "%ProgramFiles%\Python%%V\python.exe" set "PY=%ProgramFiles%\Python%%V\python.exe"
)
for %%V in (3.13 3.12 3.11 3.10) do if not defined PY call :trypy %%V
exit /b 0

:trypy
py -%1 -c "import sys" >nul 2>nul || exit /b 0
for /f "delims=" %%P in ('py -%1 -c "import sys; print(sys.executable)"') do set "PY=%%P"
exit /b 0
