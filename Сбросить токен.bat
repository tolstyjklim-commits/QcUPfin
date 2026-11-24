@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist backend\.env (powershell -NoProfile -Command "(Get-Content backend\.env) -replace '^TELEGRAM_BOT_TOKEN=.*','TELEGRAM_BOT_TOKEN=replace_me' | Set-Content backend\.env" ^& echo Токен сброшен: при следующем запуске он будет запрошен снова.) else echo Токен ещё не сохранялся.
pause
