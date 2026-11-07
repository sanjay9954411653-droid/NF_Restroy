@echo off
title AuraOS Print Bridge
cd /d "%~dp0"
:loop
node bridge.js
echo Bridge stopped. Restarting in 5 seconds... (close this window to quit)
timeout /t 5 /nobreak >nul
goto loop
