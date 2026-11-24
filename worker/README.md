# Бот и платёжный сервер QcUp (Telegram Stars) на Cloudflare, выкладка через GitHub

Эта папка заменяет старый `bot-repo` (бот через Actions на 6 часов): бот теперь работает всегда, а Stars идут через него же.
Всё делает GitHub Actions: создаёт базу, подставляет адрес сайта, выкладывает Worker и подключает бота (кнопка «🎮 Играть», команда /start).

## Один раз в Cloudflare (dash.cloudflare.com, бесплатно)
1. Зарегистрируйтесь.
2. **Account ID**: страница «Workers & Pages» (или Overview), справа в колонке. Скопируйте.
3. Ключ доступа: My Profile → API Tokens → Create Token → Create Custom Token. Права (Account): **Workers Scripts: Edit** и **D1: Edit**. Скопируйте токен (показывают один раз).
Базу данных создавать не нужно, это делает workflow.

## Один раз в GitHub: четыре секрета
Репозиторий → Settings → Secrets and variables → Actions → New repository secret:
- `CLOUDFLARE_API_TOKEN` токен из шага 3,
- `CLOUDFLARE_ACCOUNT_ID` номер аккаунта из шага 2,
- `BOT_TOKEN` токен бота от @BotFather,
- `ADMIN_KEY` ваш пароль к служебным адресам (длинная случайная строка, потом нужна для журнала).
Адрес сайта подставляется сам: `https://ваш-логин.github.io/имя-репозитория/`. Если сайт на другом адресе, добавьте переменную (вкладка Variables) `WEBAPP_URL` с полным адресом (https, слэш в конце).

## Запуск
Сначала в Settings → Pages включите Source: GitHub Actions и дождитесь, пока сайт откроется.
Потом вкладка Actions → «Deploy bot and payments» → Run workflow. Готово, если все шаги зелёные.
В отчёте запуска (Summary) будет строка «Адрес сервера платежей - https://….workers.dev». Если упадёт шаг «Prepare», в красной строке написано, чего не хватает.

## Подключение сайта к серверу платежей
В репозитории откройте `frontend/public/config.json`, нажмите карандаш и впишите адрес из отчёта:
`{ "apiUrl": "https://qcup-pay.….workers.dev" }`
Commit, через пару минут сайт обновится сам.

## Проверка
1. Напишите боту /start: придёт приветствие с кнопкой «🎮 Играть».
2. В игре «Пополнить» → Telegram Stars → 10 Stars. Оплата настоящая (около 20 центов). ⭐ появятся сами, повторно не зачислятся.
3. Журнал: `curl.exe https://….workers.dev/admin/log -H "Authorization: Bearer ВАШ_ADMIN_KEY"`, одна заявка: добавьте `?memo=qc-xxxxxxxxxxxx`. Живые логи: Cloudflare → Workers & Pages → qcup-pay → Logs.
   События: deposit_created, stars_precheckout, deposit_credited, claimed, duplicate_tx, stars_orphan (деньги списаны, а заявки нет: разобрать вручную), invoice_failed, greet_failed.

## Тексты бота (необязательно)
В `worker/wrangler.toml` можно добавить `BOT_BUTTON_TEXT`, `BOT_WELCOME_TEXT` (HTML), `BOT_WELCOME_IMAGE` (https-ссылка на картинку), как раньше в bot.mjs.

## Важно
- Старый бот (bot.yml, bot.mjs, `npm`-бэкенд на VPS) должен быть выключен: у одного бота либо вебхук, либо опрос, не оба сразу.
- Работают только Stars. TON и USDT при включённом сервере из окна пополнения пропадают.
- Баланс в играх пока хранится в браузере игрока: платёж настоящий и защищённый, но сам баланс можно подделать, пока игры не переехали на сервер. Вывода делать нельзя.
- Stars поступают на баланс бота, вывод делается через настройки бота в Telegram с задержкой Telegram.
- Токен бота хранится только в секретах GitHub и Cloudflare.
