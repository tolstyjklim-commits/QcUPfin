-- База Cloudflare D1 для платежей Stars. Выполняется один раз (см. README.md).
CREATE TABLE IF NOT EXISTS deposits (
  memo        TEXT PRIMARY KEY,          -- уникальный номер заявки qc-xxxxxxxxxxxx, он же payload счёта
  tg_id       TEXT NOT NULL,             -- кто платит (id в Telegram, проверен по initData)
  asset       TEXT NOT NULL DEFAULT 'STARS',
  stars       INTEGER NOT NULL,          -- сумма счёта в Stars
  rate        REAL NOT NULL,             -- сколько ⭐ игры за 1 Star, зафиксировано при создании
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | credited
  paid        INTEGER,                   -- сколько реально оплачено
  coins       INTEGER,                   -- сколько ⭐ игры начислено
  tx          TEXT UNIQUE,               -- номер платежа Telegram: один платёж закрывает одну заявку
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  credited_at INTEGER,
  claimed_at  INTEGER                    -- когда игра забрала ⭐ (один раз)
);
CREATE INDEX IF NOT EXISTS deposits_user ON deposits (tg_id, status, claimed_at);

-- Журнал платежей: одно событие на строку
CREATE TABLE IF NOT EXISTS pay_log (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  t     INTEGER NOT NULL,
  event TEXT NOT NULL,
  memo  TEXT,
  data  TEXT
);
CREATE INDEX IF NOT EXISTS pay_log_memo ON pay_log (memo);
