// Бот и платёжный сервер QcUp на Cloudflare Workers: /start с кнопкой «Играть», вход через Telegram, пополнение Stars, журнал.
// Бот работает через вебхук, поэтому он включён всегда: старый bot-repo (bot.mjs в GitHub Actions) больше не нужен.
// Работает по тому же протоколу, что backend/src/ton.ts, поэтому окно «Пополнить» на сайте ничем не отличается.
//
//   GET  /api/deposit/config         настройки для окна пополнения
//   POST /api/deposit/stars          создать счёт Stars (нужен вход через Telegram)
//   GET  /api/deposit/ton/:memo      статус заявки (имя историческое, работает для любой)
//   GET  /api/deposit/unclaimed      зачисленные, но ещё не полученные игрой ⭐
//   POST /api/deposit/claim          получить их (один раз)
//   POST /telegram/webhook           сюда Telegram присылает платежи
//   POST /admin/set-webhook          подключает бота к Worker, ставит кнопку меню и команду /start (Authorization: Bearer ADMIN_KEY). Workflow делает это сам
//   GET  /admin/log?memo=…           журнал платежей (Authorization: Bearer ADMIN_KEY)
//
// Секреты (wrangler secret put): BOT_TOKEN, WEBHOOK_SECRET, ADMIN_KEY. Токен бота нигде не отдаётся и не пишется в журнал.

const enc = new TextEncoder()
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('')
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)

const conf = env => ({
  min: Math.round(num(env.MIN_STARS, 10)), max: Math.round(num(env.MAX_STARS, 100000)),
  rate: num(env.COINS_PER_STAR, 1), ttlMs: num(env.TTL_MIN, 60) * 60_000,
})

// ---------- таблицы базы: Worker создаёт их сам при первом запросе (CREATE ... IF NOT EXISTS), поэтому ключу Cloudflare не нужны права на запись в D1 ----------
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS deposits (
    memo TEXT PRIMARY KEY, tg_id TEXT NOT NULL, asset TEXT NOT NULL DEFAULT 'STARS', stars INTEGER NOT NULL, rate REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', paid INTEGER, coins INTEGER, tx TEXT UNIQUE,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, credited_at INTEGER, claimed_at INTEGER)`,
  'CREATE INDEX IF NOT EXISTS deposits_user ON deposits (tg_id, status, claimed_at)',
  'CREATE TABLE IF NOT EXISTS pay_log (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, event TEXT NOT NULL, memo TEXT, data TEXT)',
  'CREATE INDEX IF NOT EXISTS pay_log_memo ON pay_log (memo)',
]
let schemaReady = null
function ensureSchema(env) {
  if (!schemaReady) schemaReady = env.DB.batch(SCHEMA.map(q => env.DB.prepare(q))).catch(e => { schemaReady = null; throw e })
  return schemaReady
}

// ---------- ответы и CORS ----------
function cors(env, req) {
  const origin = req.headers.get('origin') || ''
  let fromUrl = ''; try { fromUrl = env.WEBAPP_URL ? new URL(env.WEBAPP_URL).origin : '' } catch { /* неверный адрес */ }
  const allowed = env.ALLOWED_ORIGIN || fromUrl || '*'
  return {
    'access-control-allow-origin': allowed === '*' ? '*' : origin === allowed ? origin : allowed,
    'access-control-allow-headers': 'content-type, x-telegram-init-data',
    'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-max-age': '86400', vary: 'origin',
  }
}
const json = (env, req, body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors(env, req) } })

// ---------- журнал ----------
async function plog(env, event, memo, data = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), event, memo, ...data })
  console.log('[pay]', line) // виден в Cloudflare: Workers → qcup-pay → Logs
  try { await env.DB.prepare('INSERT INTO pay_log (t, event, memo, data) VALUES (?, ?, ?, ?)').bind(Date.now(), event, memo || null, JSON.stringify(data)).run() } catch { /* журнал не должен ронять платёж */ }
}

// ---------- вход через Telegram: проверка подписи initData ----------
async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data))
}
const sameStr = (a, b) => { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0 }

// Подпись делается токеном бота, подделать её без токена нельзя. Возвращает пользователя Telegram или null.
async function authUser(env, req) {
  const raw = req.headers.get('x-telegram-init-data') || ''
  if (!raw || !env.BOT_TOKEN) return null
  const p = new URLSearchParams(raw)
  const hash = p.get('hash'); if (!hash) return null
  p.delete('hash')
  const check = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n')
  const secret = await hmac(enc.encode('WebAppData'), enc.encode(env.BOT_TOKEN))
  if (!sameStr(hex(await hmac(secret, enc.encode(check))), hash)) return null
  const age = Date.now() / 1000 - Number(p.get('auth_date'))
  if (!(age > -300 && age < 86_400)) return null // вход старше суток не принимаем
  try { const u = JSON.parse(p.get('user') || ''); return u && u.id ? { id: String(u.id) } : null } catch { return null }
}

// ---------- Telegram Bot API ----------
async function tg(env, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) })
  const j = await r.json()
  if (!j.ok) throw new Error(`telegram ${method}: ${j.description || r.status}`)
  return j.result
}

// ---------- приветствие бота (то же, что делал bot.mjs) ----------
const DEFAULT_WELCOME = '<b>QcUp</b>: мини-игры с подарками.\n\nВсе монеты и подарки виртуальные.\n\nНажми кнопку ниже, чтобы запустить.'
async function greet(env, chatId) {
  if (!env.WEBAPP_URL) return
  const markup = { inline_keyboard: [[{ text: env.BOT_BUTTON_TEXT || '🎮 Играть', web_app: { url: env.WEBAPP_URL } }]] }
  const welcome = env.BOT_WELCOME_TEXT || DEFAULT_WELCOME
  if (env.BOT_WELCOME_IMAGE) await tg(env, 'sendPhoto', { chat_id: chatId, photo: env.BOT_WELCOME_IMAGE, caption: welcome, parse_mode: 'HTML', reply_markup: markup })
  else await tg(env, 'sendMessage', { chat_id: chatId, text: welcome, parse_mode: 'HTML', reply_markup: markup })
}

const newMemo = () => 'qc-' + [...crypto.getRandomValues(new Uint8Array(12))].map(b => (b % 36).toString(36)).join('')

// ---------- API для сайта ----------
async function createStars(env, req) {
  const c = conf(env)
  const user = await authUser(env, req)
  if (!user) return json(env, req, { error: 'Войдите через Telegram, чтобы пополнить баланс.' }, 401)
  let body = {}; try { body = await req.json() } catch { /* пусто */ }
  const stars = Number(body.stars)
  if (!Number.isInteger(stars) || stars < c.min || stars > c.max) return json(env, req, { error: `Сумма от ${c.min} до ${c.max} Stars, целым числом` }, 400)
  const now = Date.now()
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM deposits WHERE tg_id = ? AND status = 'pending' AND expires_at > ?").bind(user.id, now).first()
  if (open.n >= 5) { await plog(env, 'deposit_rejected', null, { reason: 'слишком много незавершённых', tg: user.id }); return json(env, req, { error: 'Слишком много незавершённых пополнений, подожди или оплати существующие' }, 429) }
  const memo = newMemo(), coins = Math.floor(stars * c.rate)
  await env.DB.prepare('INSERT INTO deposits (memo, tg_id, stars, rate, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)').bind(memo, user.id, stars, c.rate, now, now + c.ttlMs).run()
  try {
    const invoiceLink = await tg(env, 'createInvoiceLink', { title: `${coins} ⭐ для QcUp`, description: `Пополнение баланса игры на ${coins} ⭐`, payload: memo, currency: 'XTR', prices: [{ label: `${coins} ⭐`, amount: stars }] })
    await plog(env, 'deposit_created', memo, { tg: user.id, stars, coins, rate: c.rate })
    return json(env, req, { memo, stars, coins, invoiceLink, expiresAt: now + c.ttlMs })
  } catch (e) {
    await env.DB.prepare("UPDATE deposits SET expires_at = ? WHERE memo = ?").bind(now - 1, memo).run() // заявку гасим
    await plog(env, 'invoice_failed', memo, { error: String(e.message || e) })
    return json(env, req, { error: 'Не удалось создать счёт, попробуйте позже' }, 502)
  }
}

async function status(env, req, memo) {
  const user = await authUser(env, req)
  if (!user) return json(env, req, { error: 'unauthorized' }, 401)
  const d = await env.DB.prepare('SELECT status, coins, expires_at FROM deposits WHERE memo = ? AND tg_id = ?').bind(memo, user.id).first()
  if (!d) return json(env, req, { error: 'not found' }, 404)
  const st = d.status === 'credited' ? 'credited' : d.expires_at < Date.now() ? 'expired' : 'pending'
  return json(env, req, { status: st, coins: d.coins == null ? null : String(d.coins) })
}

async function unclaimed(env, req) {
  const user = await authUser(env, req)
  if (!user) return json(env, req, { error: 'unauthorized' }, 401)
  const { results } = await env.DB.prepare("SELECT memo, coins, asset FROM deposits WHERE tg_id = ? AND status = 'credited' AND claimed_at IS NULL LIMIT 50").bind(user.id).all()
  return json(env, req, results.map(r => ({ id: r.memo, coins: String(r.coins), asset: r.asset })))
}

// «Получить» срабатывает один раз на заявку: UPDATE с условием claimed_at IS NULL, второй вызов ничего не изменит
async function claim(env, req) {
  const user = await authUser(env, req)
  if (!user) return json(env, req, { error: 'unauthorized' }, 401)
  let body = {}; try { body = await req.json() } catch { /* пусто */ }
  const ids = Array.isArray(body.ids) ? body.ids.filter(x => typeof x === 'string').slice(0, 50) : []
  let total = 0
  for (const id of ids) {
    const d = await env.DB.prepare("SELECT coins FROM deposits WHERE memo = ? AND tg_id = ? AND status = 'credited' AND claimed_at IS NULL").bind(id, user.id).first()
    if (!d) continue
    const r = await env.DB.prepare('UPDATE deposits SET claimed_at = ? WHERE memo = ? AND claimed_at IS NULL').bind(Date.now(), id).run()
    if (r.meta.changes === 1) { total += Number(d.coins || 0); await plog(env, 'claimed', id, { coins: d.coins, tg: user.id }) }
  }
  return json(env, req, { coins: String(total) })
}

// ---------- вебхук Telegram ----------
async function webhook(env, req) {
  if (!env.WEBHOOK_SECRET || !sameStr(req.headers.get('x-telegram-bot-api-secret-token') || '', env.WEBHOOK_SECRET)) return new Response('forbidden', { status: 403 })
  const u = await req.json()
  const q = u.pre_checkout_query
  if (q) {
    // Telegram ждёт ответ 10 секунд. Соглашаемся, только если заявка живая, своя и на ту же сумму
    const d = await env.DB.prepare('SELECT tg_id, stars, status, expires_at FROM deposits WHERE memo = ?').bind(q.invoice_payload).first()
    const ok = !!d && d.status === 'pending' && d.expires_at > Date.now() && q.currency === 'XTR' && d.stars === q.total_amount && d.tg_id === String(q.from.id)
    await plog(env, 'stars_precheckout', q.invoice_payload, { ok, stars: q.total_amount, currency: q.currency })
    await tg(env, 'answerPreCheckoutQuery', ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: 'Счёт недействителен или истёк. Создайте новый в игре.' })
    return new Response('ok')
  }
  const m = u.message
  if (m && m.chat && m.chat.type === 'private' && /^\/start(\s|@|$)/.test(m.text || '')) {
    try { await greet(env, m.chat.id) } catch (e) { await plog(env, 'greet_failed', null, { error: String(e.message || e) }) }
    return new Response('ok')
  }
  const pay = u.message && u.message.successful_payment
  if (pay && pay.currency === 'XTR') {
    const memo = pay.invoice_payload, charge = pay.telegram_payment_charge_id, from = String(u.message.from && u.message.from.id)
    const d = await env.DB.prepare('SELECT tg_id, rate, status FROM deposits WHERE memo = ?').bind(memo).first()
    if (!d || d.tg_id !== from) { await plog(env, 'stars_orphan', memo, { tx: charge, stars: pay.total_amount, reason: 'нет заявки или платил не её владелец: деньги списаны, разберите вручную' }); return new Response('ok') }
    const coins = Math.floor(pay.total_amount * d.rate)
    try {
      // деньги уже списаны, поэтому зачисляем даже если заявка истекла. tx UNIQUE: один платёж Telegram не закроет две заявки
      const r = await env.DB.prepare("UPDATE deposits SET status = 'credited', paid = ?, coins = ?, tx = ?, credited_at = ? WHERE memo = ? AND status != 'credited'").bind(pay.total_amount, coins, charge, Date.now(), memo).run()
      await plog(env, r.meta.changes === 1 ? 'deposit_credited' : 'duplicate_tx', memo, { tx: charge, paid: pay.total_amount, coins, rate: d.rate })
    } catch (e) {
      await plog(env, 'duplicate_tx', memo, { tx: charge, error: String(e.message || e) })
    }
  }
  return new Response('ok')
}

// ---------- служебное ----------
const isAdmin = (env, req) => !!env.ADMIN_KEY && sameStr(req.headers.get('authorization') || '', `Bearer ${env.ADMIN_KEY}`)

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env, req) })
    try {
      await ensureSchema(env)
      if (path === '/api/deposit/config' && req.method === 'GET') {
        const c = conf(env)
        return json(env, req, { enabled: true, address: '', coinsPerTon: 0, minTon: 0, maxTon: 0, ttlMin: c.ttlMs / 60_000, usdt: { min: 1, max: 1, coinsPerUsdt: 0 }, stars: { enabled: !!env.BOT_TOKEN, min: c.min, max: c.max, coinsPerStar: c.rate } })
      }
      if (path === '/api/deposit/stars' && req.method === 'POST') return await createStars(env, req)
      const m = path.match(/^\/api\/deposit\/ton\/([a-z0-9-]{3,40})$/)
      if (m && req.method === 'GET') return await status(env, req, m[1])
      if (path === '/api/deposit/unclaimed' && req.method === 'GET') return await unclaimed(env, req)
      if (path === '/api/deposit/claim' && req.method === 'POST') return await claim(env, req)
      if (path === '/telegram/webhook' && req.method === 'POST') return await webhook(env, req)
      if (path === '/admin/set-webhook' && req.method === 'POST') {
        if (!isAdmin(env, req)) return new Response('forbidden', { status: 403 })
        await tg(env, 'setWebhook', { url: `${url.origin}/telegram/webhook`, secret_token: env.WEBHOOK_SECRET, allowed_updates: ['pre_checkout_query', 'message'], drop_pending_updates: false })
        let extra = ''
        if (env.WEBAPP_URL) {
          try {
            await tg(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: env.BOT_BUTTON_TEXT || '🎮 Играть', web_app: { url: env.WEBAPP_URL } } })
            await tg(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Запустить игру' }] })
            extra = ' Кнопка меню и команда /start настроены.'
          } catch (e) { extra = ` Кнопку меню поставить не удалось: ${e.message}` }
        } else extra = ' WEBAPP_URL не задан: кнопка «Играть» не настроена.'
        return new Response(`Вебхук установлен: ${url.origin}/telegram/webhook.${extra}\n`)
      }
      if (path === '/admin/log' && req.method === 'GET') {
        if (!isAdmin(env, req)) return new Response('forbidden', { status: 403 })
        const memo = url.searchParams.get('memo')
        const { results } = memo ? await env.DB.prepare('SELECT * FROM pay_log WHERE memo = ? ORDER BY id DESC LIMIT 200').bind(memo).all() : await env.DB.prepare('SELECT * FROM pay_log ORDER BY id DESC LIMIT 200').all()
        return new Response(results.map(r => JSON.stringify({ t: new Date(r.t).toISOString(), event: r.event, memo: r.memo, ...JSON.parse(r.data || '{}') })).join('\n') + '\n', { headers: { 'content-type': 'text/plain; charset=utf-8' } })
      }
      if (path === '/' ) return new Response('QcUp payments: ok\n')
      return new Response('not found', { status: 404 })
    } catch (e) {
      console.error('[pay] ошибка', String(e && e.message || e))
      // для вебхука отвечаем 500: Telegram повторит доставку, а зачисление идемпотентно
      return path === '/telegram/webhook' ? new Response('error', { status: 500 }) : json(env, req, { error: 'Ошибка сервера' }, 500)
    }
  },
}
