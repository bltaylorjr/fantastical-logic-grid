@echo off
title Vox voice engine
cd /d "%~dp0"
rem Runs Vox in this window (to see what it's doing). Normally it runs hidden:
rem it starts by itself at sign-in, or with the Vox shortcut on the desktop.
set "VPY=%LocalAppData%\Vox\venv\Scripts\python.exe"
if not exist "%VPY%" (
  echo Vox isn't set up yet. Double-click "Setup Vox.cmd" first.
  pause
  exit /b 1
)
set "MODEL=practice.pt"
if exist "runs\v1\vox.pt" set "MODEL=runs\v1\vox.pt"
echo Starting Vox. Leave this window open: closing it stops Vox.
echo.
"%VPY%" -m vox.cli serve --ckpt "%MODEL%"
echo.
echo Vox has stopped. If there is an error above, copy it and ask Claude for help.
pause
