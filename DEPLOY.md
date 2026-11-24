# Развёртывание QcUp

Сайт остаётся на GitHub Pages, бэкенд (пополнение TON и USDT, база, бот) работает на VPS.

## 1. VPS
Нужен Linux-сервер с Docker и домен (например `api.example.com`), направленный A-записью на IP сервера. HTTPS обязателен для Telegram.

1. Загрузите на сервер папки `backend` и `deploy`.
2. Создайте `backend/.env` по образцу `backend/.env.example`. Обязательно: `TELEGRAM_BOT_TOKEN`, `WEBAPP_URL` (адрес сайта на Pages), `TON_DEPOSIT_ADDRESS`, `TONCENTER_API_KEY`, `FRONTEND_ORIGIN` (адрес сайта на Pages, без слэша на конце). `DATABASE_URL` задавать не нужно.
3. Создайте `deploy/.env` по образцу `deploy/.env.example` (`DB_PASSWORD`, `API_DOMAIN`).
4. Запуск: `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build`
5. Проверка: откройте `https://<API_DOMAIN>/health`, должно вернуться `{"ok":true,...}`.

Таблицы создаются автоматически при старте. Обновление: загрузите новые файлы и повторите команду из п. 4.

## 2. Сайт
В репозитории на GitHub: Settings → Secrets and variables → Actions → Variables → создайте `VITE_API_URL` = `https://<API_DOMAIN>`. После push в `main` сайт пересоберётся.

## 3. Бот
Бот теперь работает внутри бэкенда на VPS. Остановите запуск через GitHub Actions (`bot-repo`), иначе Telegram вернёт ошибку 409 из-за двух одновременных опросов.

## Безопасность
- Не публикуйте `backend/.env` и не добавляйте его в репозиторий.
- Откройте на сервере только порты 80 и 443 (и SSH).
