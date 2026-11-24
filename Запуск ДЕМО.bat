@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" http://localhost:5180/
node demo-server.mjs
pause
