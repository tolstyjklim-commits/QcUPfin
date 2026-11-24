# Запуск: PowerShell в папке QcUp ->  .\deploy.ps1
# Нужен VPS с Ubuntu/Debian, доступ по SSH (ключ или пароль) и домен, направленный A-записью на IP сервера.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$server  = Read-Host 'SSH-адрес сервера (например root@123.45.67.89)'
$domain  = Read-Host 'Домен бэкенда (например api.example.com)'
$webapp  = Read-Host 'Адрес сайта на GitHub Pages (https://имя.github.io/репо, без слэша в конце)'
$token   = Read-Host 'Токен Telegram-бота (BotFather)'
$tonAddr = Read-Host 'Адрес TON-кошелька для приёма платежей'
$tonKey  = Read-Host 'Ключ toncenter (можно пусто)'
$dbPass  = -join ((48..57)+(65..90)+(97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })

$be = @"
TELEGRAM_BOT_TOKEN=$token
WEBAPP_URL=$webapp
FRONTEND_ORIGIN=$webapp
API_PORT=4000
BOT_ENABLED=1
TON_DEPOSIT_ADDRESS=$tonAddr
TONCENTER_API_KEY=$tonKey
COINS_PER_TON=150
COINS_PER_USDT=100
"@
$dp = @"
DB_PASSWORD=$dbPass
API_DOMAIN=$domain
"@
$tmp = Join-Path $env:TEMP "qcup-deploy"; New-Item -ItemType Directory -Force $tmp | Out-Null
# LF-окончания, иначе Linux не прочитает .env
[IO.File]::WriteAllText("$tmp\backend.env", ($be -replace "`r`n","`n"))
[IO.File]::WriteAllText("$tmp\deploy.env",  ($dp -replace "`r`n","`n"))

Write-Host '1/4 Docker на сервере...'
ssh $server 'command -v docker >/dev/null || (curl -fsSL https://get.docker.com | sh); mkdir -p /opt/qcup'
Write-Host '2/4 Загрузка проекта...'
tar --exclude=node_modules --exclude=dist --exclude=.env -czf "$tmp\qcup.tgz" backend deploy
scp "$tmp\qcup.tgz" "${server}:/opt/qcup/qcup.tgz"
scp "$tmp\backend.env" "${server}:/opt/qcup/backend.env"
scp "$tmp\deploy.env"  "${server}:/opt/qcup/deploy.env"
Write-Host '3/4 Запуск...'
ssh $server 'cd /opt/qcup && tar xzf qcup.tgz && mv -f backend.env backend/.env && mv -f deploy.env deploy/.env && chmod 600 backend/.env deploy/.env && docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build'
Remove-Item -Recurse -Force $tmp
Write-Host "4/4 Готово. Проверь: https://$domain/health"
Write-Host "Осталось: в GitHub добавь переменную Actions VITE_API_URL = https://$domain и останови бота в GitHub Actions."
