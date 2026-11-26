// Бот и платёжный сервер QcUp на Cloudflare Workers: /start с кнопкой «Играть», вход через Telegram, пополнение Stars, журнал.
// Бот работает через вебхук, поэтому он включён всегда: старый bot-repo (bot.mjs в GitHub Actions) больше не нужен.
// Работает по тому же протоколу, что backend/src/ton.ts, поэтому окно «Пополнить» на сайте ничем не отличается.
//
//   GET  /api/deposit/config         настройки для окна пополнения
//   POST /api/deposit/stars          создать счёт Stars (нужен вход через Telegram)
//   POST /api/deposit/crypto         счёт через @send (Crypto Pay), @wallet (Wallet Pay) или @xRocket: {provider:'SEND'|'WALLET'|'XROCKET', usd}
//   POST /pay/send/<WEBHOOK_SECRET>, /pay/wallet/<WEBHOOK_SECRET>, /pay/xrocket/<WEBHOOK_SECRET>   вебхуки этих сервисов (необязательны: статус сверяется и опросом)
//   GET  /api/deposit/ton/:memo      статус заявки (имя историческое, работает для любой)
//   GET  /api/deposit/unclaimed      зачисленные, но ещё не полученные игрой ⭐
//   POST /api/deposit/claim          получить их (один раз)
//   POST /telegram/webhook           сюда Telegram присылает платежи
//   POST /admin/set-webhook          подключает бота к Worker, ставит кнопку меню и команду /start (Authorization: Bearer ADMIN_KEY). Workflow делает это сам
//   GET  /admin/log?memo=…           журнал платежей (Authorization: Bearer ADMIN_KEY)
//
// Секреты (wrangler secret put): BOT_TOKEN, WEBHOOK_SECRET, ADMIN_KEY; для крипты: SEND_TOKEN, WALLET_API_KEY, XROCKET_TOKEN (любые из трёх) и PAY_HOOK_KEY (постоянный ключ в адресе вебхуков касс). Токен бота нигде не отдаётся и не пишется в журнал.

let CTX = null // контекст запроса: нужен, чтобы запись в GitHub шла в фоне и не задерживала ответ
const defer = p => { const q = Promise.resolve(p).catch(() => {}); if (CTX && CTX.waitUntil) CTX.waitUntil(q) }
const enc = new TextEncoder()
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('')
const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)

const conf = env => ({
  min: Math.round(num(env.MIN_STARS, 10)), max: Math.round(num(env.MAX_STARS, 100000)),
  rate: num(env.COINS_PER_STAR, 1), ttlMs: num(env.TTL_MIN, 60) * 60_000,
  usdMin: num(env.MIN_USD, 1), usdMax: num(env.MAX_USD, 5000), coinsPerUsd: num(env.COINS_PER_USD, 100),
})
// Крипто-кассы: заявка хранится в той же таблице deposits. asset = SEND | WALLET | XROCKET, stars = сумма счёта в центах USD, tx = «касса:номер счёта у кассы»
const PROVIDERS = ['SEND', 'WALLET', 'XROCKET']
const providerOn = (env, p) => !!(p === 'SEND' ? env.SEND_TOKEN : p === 'WALLET' ? env.WALLET_API_KEY : p === 'XROCKET' ? env.XROCKET_TOKEN : '')
const SEND_API = env => (env.SEND_API_URL || 'https://pay.crypt.bot/api').replace(/\/$/, '')
const XR_API = env => (env.XROCKET_API_URL || 'https://pay.xrocket.tg').replace(/\/$/, '')
const WALLET_API = env => (env.WALLET_API_URL || 'https://pay.wallet.tg').replace(/\/$/, '')

// ---------- таблицы базы: Worker создаёт их сам при первом запросе (CREATE ... IF NOT EXISTS), поэтому ключу Cloudflare не нужны права на запись в D1 ----------
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS deposits (
    memo TEXT PRIMARY KEY, tg_id TEXT NOT NULL, asset TEXT NOT NULL DEFAULT 'STARS', stars INTEGER NOT NULL, rate REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', paid INTEGER, coins INTEGER, tx TEXT UNIQUE,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, credited_at INTEGER, claimed_at INTEGER)`,
  'CREATE INDEX IF NOT EXISTS deposits_user ON deposits (tg_id, status, claimed_at)',
  'CREATE TABLE IF NOT EXISTS pay_log (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, event TEXT NOT NULL, memo TEXT, data TEXT)',
  'CREATE INDEX IF NOT EXISTS pay_log_memo ON pay_log (memo)',
  // игроки, события игр и заявки на вывод (тестовая система выводов)
  `CREATE TABLE IF NOT EXISTS players (
    tg_id TEXT PRIMARY KEY, name TEXT, username TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL,
    balance INTEGER, level INTEGER, rounds INTEGER NOT NULL DEFAULT 0, staked INTEGER NOT NULL DEFAULT 0, won INTEGER NOT NULL DEFAULT 0,
    big_win INTEGER NOT NULL DEFAULT 0, last_seq INTEGER NOT NULL DEFAULT 0, mirror_at INTEGER NOT NULL DEFAULT 0, note TEXT)`,
  `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, tg_id TEXT NOT NULL, t INTEGER NOT NULL, kind TEXT NOT NULL, game TEXT, amount INTEGER NOT NULL)`,
  'CREATE INDEX IF NOT EXISTS events_user ON events (tg_id, id)',
  `CREATE TABLE IF NOT EXISTS withdrawals (
    id TEXT PRIMARY KEY, client_key TEXT NOT NULL, tg_id TEXT NOT NULL, coins INTEGER NOT NULL, usd_cents INTEGER NOT NULL,
    method TEXT NOT NULL, address TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', flags TEXT,
    created_at INTEGER NOT NULL, decided_at INTEGER, admin_note TEXT, txid TEXT, UNIQUE (tg_id, client_key))`,
  'CREATE INDEX IF NOT EXISTS withdrawals_status ON withdrawals (status, created_at)',
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
  // админ-панель лежит отдельно от игры (её нет на сайте для игроков): её адрес разрешается через ADMIN_ORIGIN (можно несколько через запятую)
  const adminOk = !!origin && String(env.ADMIN_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean).includes(origin)
  return {
    'access-control-allow-origin': adminOk ? origin : allowed === '*' ? '*' : origin === allowed ? origin : allowed,
    'access-control-allow-headers': 'content-type, x-telegram-init-data, authorization',
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
  try { const u = JSON.parse(p.get('user') || ''); return u && u.id ? { id: String(u.id), name: cleanName([u.first_name, u.last_name].filter(Boolean).join(' '), 80), username: cleanName(u.username, 40) } : null } catch { return null }
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
  await touchPlayer(env, user)
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
  let d = await env.DB.prepare('SELECT memo, tg_id, asset, stars, rate, tx, status, coins, expires_at FROM deposits WHERE memo = ? AND tg_id = ?').bind(memo, user.id).first()
  if (!d) return json(env, req, { error: 'not found' }, 404)
  if (d.status !== 'credited' && PROVIDERS.includes(d.asset) && await syncProvider(env, d, 'poll')) d = await env.DB.prepare('SELECT status, coins, expires_at FROM deposits WHERE memo = ? AND tg_id = ?').bind(memo, user.id).first()
  const st = d.status === 'credited' ? 'credited' : d.expires_at < Date.now() ? 'expired' : 'pending'
  return json(env, req, { status: st, coins: d.coins == null ? null : String(d.coins) })
}

async function unclaimed(env, req) {
  const user = await authUser(env, req)
  if (!user) return json(env, req, { error: 'unauthorized' }, 401)
  // счета касс, которые игрок мог оплатить и закрыть окно: сверяем с кассой (не больше трёх за раз)
  const wait = await env.DB.prepare("SELECT memo, tg_id, asset, stars, rate, tx, status FROM deposits WHERE tg_id = ? AND status = 'pending' AND asset IN ('SEND','WALLET','XROCKET') AND tx IS NOT NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 3").bind(user.id, Date.now() - 3_600_000).all()
  for (const w of wait.results) await syncProvider(env, w, 'unclaimed')
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

// ---------- крипто-кассы: @send (Crypto Pay), @wallet (Wallet Pay), @xRocket ----------
// Принцип: монеты зачисляются только после того, как сама касса по нашему ключу подтвердила, что счёт оплачен (статус paid, наш payload, наша сумма).
// Вебхук лишь сигнал «проверь сейчас»; подделка вебхука ничего не зачисляет. Сумму зачисления берём из нашей заявки, а не из присланных данных.
const sha256 = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))
const b64 = bytes => btoa(String.fromCharCode(...bytes))
const usdOf = d => d.stars / 100 // в колонке stars лежит сумма счёта в центах

async function http(url, init) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(9000) })
  let j = null; try { j = await r.json() } catch { /* не JSON */ }
  return { ok: r.ok, status: r.status, j }
}

// возвращает { id, url } или бросает ошибку
async function createInvoiceAt(env, provider, { memo, usd, coins, ttlSec, tgId }) {
  const description = `${coins} ⭐ для QcUp`
  if (provider === 'SEND') {
    const r = await http(`${SEND_API(env)}/createInvoice`, {
      method: 'POST', headers: { 'Crypto-Pay-API-Token': env.SEND_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ currency_type: 'fiat', fiat: 'USD', amount: usd.toFixed(2), description, payload: memo, expires_in: ttlSec, allow_comments: false, allow_anonymous: false }),
    })
    const inv = r.j && r.j.ok && r.j.result
    const url = inv && (inv.mini_app_invoice_url || inv.bot_invoice_url)
    if (!inv || !url) throw new Error(`send createInvoice: ${(r.j && r.j.error && (r.j.error.name || r.j.error)) || r.status}`)
    return { id: String(inv.invoice_id), url }
  }
  if (provider === 'XROCKET') {
    const r = await http(`${XR_API(env)}/tg-invoices`, {
      method: 'POST', headers: { 'Rocket-Pay-Key': env.XROCKET_TOKEN, 'content-type': 'application/json' },
      body: JSON.stringify({ amount: usd, currency: 'USDT', numPayments: 1, description, payload: memo, commentsEnabled: false, expiredIn: Math.min(ttlSec, 86_400) }),
    })
    const inv = r.j && r.j.success !== false && r.j.data
    if (!inv || !inv.id || !inv.link) throw new Error(`xrocket tg-invoices: ${(r.j && (r.j.message || r.j.error)) || r.status}`)
    return { id: String(inv.id), url: String(inv.link) }
  }
  // WALLET
  const back = env.RETURN_URL || env.WEBAPP_URL || 'https://t.me/wallet'
  const r = await http(`${WALLET_API(env)}/wpay/store-api/v1/order`, {
    method: 'POST', headers: { 'Wpay-Store-Api-Key': env.WALLET_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ amount: { currencyCode: 'USD', amount: usd.toFixed(2) }, description, externalId: memo, timeoutSeconds: ttlSec, customerTelegramUserId: Number(tgId), returnUrl: back, failReturnUrl: back, customData: memo }),
  })
  const o = r.j && (r.j.status === 'SUCCESS' || r.j.status === 'ALREADY') && r.j.data
  const url = o && (o.directPayLink || o.payLink)
  if (!o || !url) throw new Error(`wallet order: ${(r.j && (r.j.message || r.j.status)) || r.status}`)
  return { id: String(o.id), url }
}

// Спрашивает у кассы, оплачен ли счёт. true только если касса подтвердила оплату нашего счёта на нашу сумму.
async function paidAtProvider(env, d) {
  const provider = d.asset, ext = String(d.tx || '').split(':')[1], usd = usdOf(d)
  if (!ext) return false
  if (provider === 'SEND') {
    const r = await http(`${SEND_API(env)}/getInvoices?invoice_ids=${encodeURIComponent(ext)}`, { headers: { 'Crypto-Pay-API-Token': env.SEND_TOKEN } })
    const inv = r.j && r.j.ok && r.j.result && r.j.result.items && r.j.result.items[0]
    return !!inv && inv.status === 'paid' && inv.payload === d.memo && Math.abs(Number(inv.amount) - usd) < 0.005
  }
  if (provider === 'XROCKET') {
    const r = await http(`${XR_API(env)}/tg-invoices/${encodeURIComponent(ext)}`, { headers: { 'Rocket-Pay-Key': env.XROCKET_TOKEN } })
    const inv = r.j && r.j.data
    return !!inv && inv.status === 'paid' && inv.payload === d.memo && Math.abs(Number(inv.amount) - usd) < 0.005
  }
  if (provider === 'WALLET') {
    const r = await http(`${WALLET_API(env)}/wpay/store-api/v1/order/preview?id=${encodeURIComponent(ext)}`, { headers: { 'Wpay-Store-Api-Key': env.WALLET_API_KEY, accept: 'application/json' } })
    const o = r.j && r.j.data
    return !!o && o.status === 'PAID' && (!o.externalId || o.externalId === d.memo)
  }
  return false
}

// Зачисление: один раз на заявку (UPDATE ... WHERE status != 'credited'), сумма берётся из заявки
async function creditProvider(env, memo, how) {
  const d = await env.DB.prepare('SELECT memo, tg_id, asset, stars, rate, status, tx FROM deposits WHERE memo = ?').bind(memo).first()
  if (!d || !PROVIDERS.includes(d.asset)) return false
  if (d.status === 'credited') return true
  const coins = Math.floor((d.stars * d.rate) / 100)
  const r = await env.DB.prepare("UPDATE deposits SET status = 'credited', paid = ?, coins = ?, credited_at = ? WHERE memo = ? AND status != 'credited'").bind(d.stars, coins, Date.now(), memo).run()
  await plog(env, r.meta.changes === 1 ? 'deposit_credited' : 'duplicate_credit', memo, { provider: d.asset, usd: usdOf(d), coins, rate: d.rate, via: how })
  if (r.meta.changes === 1) defer(mirrorPlayer(env, d.tg_id, true))
  return true
}

// Сверка заявки с кассой; true, если сейчас (или уже раньше) зачислена
async function syncProvider(env, d, how) {
  if (d.status === 'credited') return true
  if (!PROVIDERS.includes(d.asset) || !providerOn(env, d.asset)) return false
  try { if (await paidAtProvider(env, d)) return await creditProvider(env, d.memo, how) } catch (e) { await plog(env, 'provider_check_failed', d.memo, { provider: d.asset, error: String(e.message || e) }) }
  return false
}

async function createCrypto(env, req) {
  const c = conf(env)
  const user = await authUser(env, req)
  if (!user) return json(env, req, { error: 'Войдите через Telegram, чтобы пополнить баланс.' }, 401)
  await touchPlayer(env, user)
  let body = {}; try { body = await req.json() } catch { /* пусто */ }
  const provider = String(body.provider || '').toUpperCase()
  if (!PROVIDERS.includes(provider) || !providerOn(env, provider)) return json(env, req, { error: 'Этот способ оплаты недоступен' }, 400)
  const usd = Number(body.usd), cents = Math.round(usd * 100)
  if (!Number.isFinite(usd) || Math.abs(cents - usd * 100) > 1e-6 || usd < c.usdMin || usd > c.usdMax) return json(env, req, { error: `Сумма от ${c.usdMin} до ${c.usdMax} USD, не больше двух знаков после запятой` }, 400)
  const now = Date.now()
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM deposits WHERE tg_id = ? AND status = 'pending' AND expires_at > ?").bind(user.id, now).first()
  if (open.n >= 5) { await plog(env, 'deposit_rejected', null, { reason: 'слишком много незавершённых', tg: user.id }); return json(env, req, { error: 'Слишком много незавершённых пополнений, подожди или оплати существующие' }, 429) }
  const memo = newMemo(), coins = Math.floor(usd * c.coinsPerUsd)
  await env.DB.prepare('INSERT INTO deposits (memo, tg_id, asset, stars, rate, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(memo, user.id, provider, cents, c.coinsPerUsd, now, now + c.ttlMs).run()
  try {
    const inv = await createInvoiceAt(env, provider, { memo, usd: cents / 100, coins, ttlSec: Math.round(c.ttlMs / 1000), tgId: user.id })
    await env.DB.prepare('UPDATE deposits SET tx = ? WHERE memo = ?').bind(`${provider}:${inv.id}`, memo).run()
    await plog(env, 'deposit_created', memo, { tg: user.id, provider, usd: cents / 100, coins, rate: c.coinsPerUsd, ext: inv.id })
    return json(env, req, { memo, provider, usd: cents / 100, coins, payUrl: inv.url, expiresAt: now + c.ttlMs })
  } catch (e) {
    await env.DB.prepare('UPDATE deposits SET expires_at = ? WHERE memo = ?').bind(now - 1, memo).run() // заявку гасим
    await plog(env, 'invoice_failed', memo, { provider, error: String(e.message || e) })
    return json(env, req, { error: 'Не удалось создать счёт, попробуйте позже' }, 502)
  }
}

const hexOf = bytes => hex(bytes)
// ---- вебхуки: адрес содержит WEBHOOK_SECRET, поэтому посторонние его не знают; дальше подпись и проверка у самой кассы ----
async function providerWebhook(env, req, provider, secretInPath, path) {
  // адрес вебхука должен быть постоянным, поэтому у касс отдельный ключ PAY_HOOK_KEY (WEBHOOK_SECRET бота меняется при каждом выкладывании)
  const hook = env.PAY_HOOK_KEY || env.WEBHOOK_SECRET
  if (!hook || !sameStr(secretInPath, hook)) return new Response('forbidden', { status: 403 })
  if (!providerOn(env, provider)) return new Response('disabled', { status: 404 })
  const raw = await req.text()
  let data = null; try { data = JSON.parse(raw) } catch { return new Response('bad json', { status: 400 }) }
  const memos = new Set()
  let sigOk = false
  if (provider === 'SEND') {
    // HMAC-SHA256(SHA256(токен), тело), hex, заголовок crypto-pay-api-signature
    const sig = hexOf(await hmac(await sha256(env.SEND_TOKEN), enc.encode(raw)))
    sigOk = sameStr(sig, req.headers.get('crypto-pay-api-signature') || '')
    if (data.update_type === 'invoice_paid' && data.payload && data.payload.payload) memos.add(String(data.payload.payload))
  } else if (provider === 'XROCKET') {
    // по описанию API: hex HMAC-SHA256 тела с ключом SHA256(токен), заголовок rocket-pay-signature. Не полагаемся на неё: решает проверка у кассы
    const sig = hexOf(await hmac(await sha256(env.XROCKET_TOKEN), enc.encode(raw)))
    sigOk = sameStr(sig, req.headers.get('rocket-pay-signature') || '')
    const inv = data.data || data
    if (inv && inv.payload) memos.add(String(inv.payload))
  } else {
    // Wallet Pay: base64(HMAC-SHA256(ключ API, "POST.путь.метка времени.base64(тело)")), заголовок WalletPay-Signature; тело — массив событий
    const ts = req.headers.get('walletpay-timestamp') || ''
    const text = ['POST', path, ts, b64(enc.encode(raw))].join('.')
    sigOk = sameStr(b64(await hmac(enc.encode(env.WALLET_API_KEY), enc.encode(text))), req.headers.get('walletpay-signature') || '')
    for (const ev of Array.isArray(data) ? data : [data]) {
      if (ev && ev.type === 'ORDER_PAID' && ev.payload && ev.payload.externalId) memos.add(String(ev.payload.externalId))
    }
  }
  await plog(env, 'provider_webhook', null, { provider, sigOk, memos: [...memos].slice(0, 10) })
  for (const memo of [...memos].slice(0, 10)) {
    const d = await env.DB.prepare('SELECT memo, tg_id, asset, stars, rate, status, tx FROM deposits WHERE memo = ?').bind(memo).first()
    if (!d || d.asset !== provider) continue
    // Wallet Pay: подписанное событие ORDER_PAID достаточно; в остальных случаях оплату подтверждает касса по нашему ключу
    if (provider === 'WALLET' && sigOk && Array.isArray(data) && data.some(e => e && e.type === 'ORDER_PAID' && e.payload && e.payload.externalId === memo)) {
      const ev = data.find(e => e && e.type === 'ORDER_PAID' && e.payload && e.payload.externalId === memo)
      const oa = ev.payload.orderAmount
      if (oa && Math.abs(Number(oa.amount) - usdOf(d)) < 0.005 && (!oa.currencyCode || oa.currencyCode === 'USD')) { await creditProvider(env, memo, 'webhook'); continue }
    }
    await syncProvider(env, d, 'webhook-check')
  }
  return new Response('ok') // кассы повторяют доставку, пока не получат 200
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
      if (r.meta.changes === 1) defer(mirrorPlayer(env, d.tg_id, true))
    } catch (e) {
      await plog(env, 'duplicate_tx', memo, { tx: charge, error: String(e.message || e) })
    }
  }
  return new Response('ok')
}

// =====================================================================================================
// Игроки, история игр и ТЕСТОВАЯ система выводов
// Баланс и игры пока считаются в браузере игрока, поэтому события игр (ставки и выигрыши) приходят от клиента и НЕ проверены:
// в админ-панели они помечены как «со слов клиента». Проверенными считаются только пополнения, зачисленные через этот сервер.
// Выплату админ делает вручную: «принять» только отмечает заявку, деньги Worker сам не отправляет.
// Профили игроков дублируются JSON-файлами в приватный репозиторий GitHub (GITHUB_TOKEN, DATA_REPO), позже заменится базой на VPS.
// =====================================================================================================
const WMETHODS = ['TON', 'USDT_TON', 'USDT_TRC20', 'STARS']
const wconf = env => ({
  enabled: env.WITHDRAW_ENABLED !== '0', methods: WMETHODS,
  minUsd: num(env.WITHDRAW_MIN_USD, 5), maxUsd: num(env.WITHDRAW_MAX_USD, 500), coinsPerUsd: num(env.WITHDRAW_COINS_PER_USD, 100), feePct: Math.max(0, Number(env.WITHDRAW_FEE_PERCENT) || 0), coinsPerStar: num(env.WITHDRAW_COINS_PER_STAR, 1), minStars: num(env.WITHDRAW_MIN_STARS, 100),
  test: true,
})
// вывод в Telegram Stars: сколько звёзд Telegram получит игрок за эти монеты
const wstars = (env, w) => w.method === 'STARS' ? Math.floor(w.coins / wconf(env).coinsPerStar) : null
const TON_ADDR = /^(EQ|UQ|kQ|0Q)[A-Za-z0-9_-]{46}$/
const TRON_ADDR = /^T[1-9A-HJ-NP-Za-km-z]{33}$/
const cleanName = (v, n) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, n)
const int = v => (Number.isSafeInteger(Number(v)) ? Number(v) : NaN)

async function touchPlayer(env, user) {
  const now = Date.now()
  await env.DB.prepare(`INSERT INTO players (tg_id, name, username, first_seen, last_seen) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tg_id) DO UPDATE SET last_seen = excluded.last_seen, name = CASE WHEN excluded.name != '' THEN excluded.name ELSE players.name END, username = CASE WHEN excluded.username != '' THEN excluded.username ELSE players.username END`)
    .bind(user.id, user.name || '', user.username || '', now, now).run()
}

// ---------- зеркало профиля в GitHub (фон, ошибки не мешают игре) ----------
const b64utf8 = str => { const b = enc.encode(str); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s) }
async function ghFetch(env, method, path, body) {
  const r = await fetch(`https://api.github.com/repos/${env.DATA_REPO}/contents/${path}${method === 'GET' ? `?ref=${encodeURIComponent(env.DATA_BRANCH || 'main')}` : ''}`, {
    method, headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'qcup-worker', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(9000),
  })
  return r
}
async function ghWrite(env, path, obj, message) {
  const content = b64utf8(JSON.stringify(obj, null, 2))
  for (let i = 0; i < 2; i++) {
    const g = await ghFetch(env, 'GET', path)
    const sha = g.status === 200 ? (await g.json()).sha : undefined
    if (g.status !== 200 && g.status !== 404) throw new Error(`github GET ${g.status}`)
    const r = await ghFetch(env, 'PUT', path, { message, content, branch: env.DATA_BRANCH || 'main', ...(sha ? { sha } : {}) })
    if (r.status === 200 || r.status === 201) return true
    if (r.status !== 409 && r.status !== 422) throw new Error(`github PUT ${r.status}`)
  }
  throw new Error('github: конфликт записи')
}

async function playerDossier(env, id, evLimit = 300) {
  const p = await env.DB.prepare('SELECT * FROM players WHERE tg_id = ?').bind(id).first()
  if (!p) return null
  const dep = (await env.DB.prepare("SELECT memo, asset, stars, rate, coins, credited_at FROM deposits WHERE tg_id = ? AND status = 'credited' AND asset NOT IN ('REF','REFUND') ORDER BY credited_at DESC LIMIT 1000").bind(id).all()).results
    .map(d => ({ ...d, amount: d.asset === 'STARS' ? `${d.stars} Stars` : `${(d.stars / 100).toFixed(2)} USD`, usd: d.asset === 'STARS' ? +(d.stars * num(env.STAR_USD, 0.015)).toFixed(2) : d.stars / 100 }))
  const wd = (await env.DB.prepare('SELECT * FROM withdrawals WHERE tg_id = ? ORDER BY created_at DESC LIMIT 1000').bind(id).all()).results
  const bonus = (await env.DB.prepare("SELECT asset, coins, credited_at FROM deposits WHERE tg_id = ? AND status = 'credited' AND asset IN ('REF','REFUND') ORDER BY credited_at DESC LIMIT 1000").bind(id).all()).results
  const perGame = (await env.DB.prepare("SELECT game, SUM(CASE WHEN kind='bet' THEN 1 ELSE 0 END) AS rounds, SUM(CASE WHEN kind='bet' THEN amount ELSE 0 END) AS staked, SUM(CASE WHEN kind='win' THEN amount ELSE 0 END) AS won, MAX(CASE WHEN kind='win' THEN amount ELSE 0 END) AS big FROM events WHERE tg_id = ? AND kind IN ('bet','win') GROUP BY game ORDER BY staked DESC").bind(id).all()).results
  const events = (await env.DB.prepare('SELECT t, kind, game, amount FROM events WHERE tg_id = ? ORDER BY id DESC LIMIT ?').bind(id, evLimit).all()).results
  // сводка по дням за всё время (не обрезается лимитом событий) и снимки баланса: попадают и в файл на GitHub
  const daily = (await env.DB.prepare("SELECT t / 86400000 AS day, SUM(CASE WHEN kind='bet' THEN 1 ELSE 0 END) AS rounds, SUM(CASE WHEN kind='bet' THEN amount ELSE 0 END) AS staked, SUM(CASE WHEN kind='win' THEN amount ELSE 0 END) AS won, SUM(CASE WHEN kind='bonus' THEN amount ELSE 0 END) AS bonus, SUM(CASE WHEN kind='sale' THEN amount ELSE 0 END) AS sales FROM events WHERE tg_id = ? AND kind != 'bal' GROUP BY day ORDER BY day DESC LIMIT 800").bind(id).all()).results
  const balances = (await env.DB.prepare("SELECT t, amount FROM events WHERE tg_id = ? AND kind = 'bal' ORDER BY id DESC LIMIT 500").bind(id).all()).results
  const depCoins = dep.reduce((n, d) => n + (d.coins || 0), 0)
  const wdPaid = wd.filter(w => w.status === 'approved').reduce((n, w) => n + w.coins, 0)
  const wdPending = wd.filter(w => w.status === 'pending').reduce((n, w) => n + w.coins, 0)
  return {
    player: p,
    totals: { depositedCoins: depCoins, depositedUsd: +dep.reduce((n, d) => n + d.usd, 0).toFixed(2), depositsCount: dep.length, withdrawnCoins: wdPaid, withdrawnPending: wdPending,
      staked: p.staked, won: p.won, pnlPlayer: p.won - p.staked, rtp: p.staked > 0 ? +(p.won / p.staked * 100).toFixed(1) : null, rounds: p.rounds, bigWin: p.big_win,
      cashNetCoins: depCoins - wdPaid, balanceReported: p.balance, verifiedNote: 'Пополнения проверены сервером. Ставки, выигрыши и баланс присланы клиентом и не проверены.' },
    perGame, daily, balances, deposits: dep, bonus, withdrawals: wd.map(w => ({ ...w, stars: wstars(env, w) })), events,
  }
}
async function mirrorPlayer(env, id, force) {
  if (!env.GITHUB_TOKEN || !env.DATA_REPO) return
  const p = await env.DB.prepare('SELECT mirror_at FROM players WHERE tg_id = ?').bind(id).first()
  if (!p || (!force && Date.now() - p.mirror_at < 60_000)) return
  await env.DB.prepare('UPDATE players SET mirror_at = ? WHERE tg_id = ?').bind(Date.now(), id).run() // метка до записи: параллельные запросы не плодят коммиты
  try { await ghWrite(env, `players/${id}.json`, { savedAt: new Date().toISOString(), note: 'ТЕСТОВЫЕ ДАННЫЕ. Ставки и баланс присланы клиентом и не проверены; пополнения проверены сервером.', ...(await playerDossier(env, id, 1000)) }, `player ${id}`) }
  catch (e) { await plog(env, 'github_mirror_failed', null, { tg: id, error: String(e.message || e) }) }
}

// ---------- API игрока ----------
async function syncEvents(env, req) {
  const user = await authUser(env, req)
  if (!user) return json(env, req, { error: 'unauthorized' }, 401)
  const raw = await req.text(); if (raw.length > 60_000) return json(env, req, { error: 'too large' }, 413)
  let b = {}; try { b = JSON.parse(raw) } catch { /* пусто */ }
  await touchPlayer(env, user)
  const p = await env.DB.prepare('SELECT last_seq, balance FROM players WHERE tg_id = ?').bind(user.id).first()
  const now = Date.now()
  const list = (Array.isArray(b.events) ? b.events : []).slice(0, 200)
  let seq = p.last_seq, bets = 0, staked = 0, won = 0, big = 0
  const stmts = []
  for (const e of list) {
    const s = int(e && e.s), a = int(e && e.a), k = e && e.k
    if (!(s > p.last_seq) || !(a >= 0 && a <= 1e10) || !['bet', 'win', 'bonus', 'sale'].includes(k)) continue // уже учтённое или мусор
    const t = int(e.t); const tt = t > now - 7 * 86_400_000 && t <= now + 60_000 ? t : now
    stmts.push(env.DB.prepare('INSERT INTO events (tg_id, t, kind, game, amount) VALUES (?, ?, ?, ?, ?)').bind(user.id, tt, k, cleanName(e.g, 40), a))
    if (s > seq) seq = s
    if (k === 'bet') { bets++; staked += a } else if (k === 'win') { won += a; if (a > big) big = a }
  }
  const bal0 = int(b.balance)
  if (bal0 >= 0 && bal0 !== p.balance) stmts.push(env.DB.prepare("INSERT INTO events (tg_id, t, kind, game, amount) VALUES (?, ?, 'bal', '', ?)").bind(user.id, now, bal0)) // снимок баланса для истории баланса
  if (stmts.length) await env.DB.batch(stmts)
  const lvl = int(b.level), bal = int(b.balance)
  await env.DB.prepare('UPDATE players SET last_seq = ?, rounds = rounds + ?, staked = staked + ?, won = won + ?, big_win = MAX(big_win, ?), balance = ?, level = ? WHERE tg_id = ?')
    .bind(seq, bets, staked, won, big, bal >= 0 ? bal : null, lvl >= 0 ? lvl : null, user.id).run()
  if (stmts.length) await env.DB.prepare('DELETE FROM events WHERE tg_id = ? AND id <= (SELECT id FROM events WHERE tg_id = ? ORDER BY id DESC LIMIT 1 OFFSET 50000)').bind(user.id, user.id).run()
  defer(mirrorPlayer(env, user.id, false))
  return json(env, req, { ok: true, seq })
}

async function createWithdrawal(env, req) {
  const c = wconf(env)
  if (!c.enabled) return json(env, req, { error: 'Вывод временно отключён' }, 403)
  const user = await authUser(env, req)
  if (!user) return json(env, req, { error: 'Войдите через Telegram' }, 401)
  let b = {}; try { b = await req.json() } catch { /* пусто */ }
  let address = String(b.address || '').trim()
  const key = cleanName(b.key, 64), method = String(b.method || ''), coins = int(b.coins)
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) return json(env, req, { error: 'bad key' }, 400)
  await touchPlayer(env, user)
  const same = await env.DB.prepare('SELECT id, status FROM withdrawals WHERE tg_id = ? AND client_key = ?').bind(user.id, key).first()
  if (same) return json(env, req, { ok: true, id: same.id, status: same.status, repeat: true }) // повтор после обрыва связи: ничего не создаём
  if (!WMETHODS.includes(method)) return json(env, req, { error: 'Выберите способ вывода' }, 400)
  if (method === 'STARS') address = 'tg:' + user.id // звёзды уходят на этот же аккаунт Telegram, адрес не нужен
  else if (method === 'USDT_TRC20' ? !TRON_ADDR.test(address) : !TON_ADDR.test(address)) return json(env, req, { error: method === 'USDT_TRC20' ? 'Неверный адрес TRON (начинается с T)' : 'Неверный адрес TON (EQ… или UQ…)' }, 400)
  const isSt = method === 'STARS' // у Stars свой минимум в звёздах, у крипты минимум в USD
  if (isSt && wstars(env, { method, coins }) < c.minStars) return json(env, req, { error: `Минимальный вывод в Stars: ${c.minStars}` }, 400)
  const gross = Math.floor((coins * 100) / c.coinsPerUsd)
  const cents = Math.floor(gross * (1 - c.feePct / 100))
  if (!(coins > 0) || (!isSt && gross < c.minUsd * 100) || gross > c.maxUsd * 100) return json(env, req, { error: `Сумма вывода от ${c.minUsd} до ${c.maxUsd} USD (${c.coinsPerUsd} ⭐ = 1 USD)` }, 400)
  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM withdrawals WHERE tg_id = ? AND status = 'pending'").bind(user.id).first()
  if (open.n >= 3) return json(env, req, { error: 'Уже есть 3 необработанные заявки, дождитесь решения' }, 429)
  // пометки для админа (не блокируют): баланс и выигрыши известны только со слов клиента
  const pl = await env.DB.prepare('SELECT balance, staked, won FROM players WHERE tg_id = ?').bind(user.id).first()
  const dep = await env.DB.prepare("SELECT COALESCE(SUM(coins), 0) AS c FROM deposits WHERE tg_id = ? AND status = 'credited' AND asset NOT IN ('REF','REFUND')").bind(user.id).first()
  const flags = []
  if (dep.c === 0) flags.push('нет пополнений')
  if (coins > dep.c + Math.max(0, pl.won - pl.staked)) flags.push('больше пополнений и чистого выигрыша')
  if (pl.balance != null && pl.balance + coins < coins * 0.9) flags.push('баланс не сходится')
  const id = 'wd-' + [...crypto.getRandomValues(new Uint8Array(8))].map(x => (x % 36).toString(36)).join('')
  await env.DB.prepare('INSERT INTO withdrawals (id, client_key, tg_id, coins, usd_cents, method, address, flags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, key, user.id, coins, cents, method, address, flags.join('; '), Date.now()).run()
  await plog(env, 'withdraw_created', id, { tg: user.id, coins, usd: cents / 100, method, flags })
  defer(mirrorPlayer(env, user.id, true))
  return json(env, req, { ok: true, id, status: 'pending', usd: cents / 100 })
}

async function myWithdrawals(env, req) {
  const user = await authUser(env, req)
  if (!user) return json(env, req, { error: 'unauthorized' }, 401)
  const { results } = await env.DB.prepare('SELECT id, client_key, coins, usd_cents, method, address, status, created_at, decided_at, admin_note, txid FROM withdrawals WHERE tg_id = ? ORDER BY created_at DESC LIMIT 30').bind(user.id).all()
  return json(env, req, results.map(w => ({ ...w, stars: wstars(env, w), address: w.method === 'STARS' ? 'Telegram Stars' : w.address.slice(0, 6) + '…' + w.address.slice(-4) })))
}

// ---------- API админа ----------
async function adminApi(env, req, url) {
  if (!isAdmin(env, req)) { await new Promise(r => setTimeout(r, 400)); return json(env, req, { error: 'forbidden' }, 403) } // небольшая задержка против подбора ключа
  const path = url.pathname.replace('/admin/api', '')
  const q = url.searchParams, lim = Math.max(1, Math.min(500, int(q.get('limit')) || 100))
  if (path === '/overview' && req.method === 'GET') {
    const one = async sql => (await env.DB.prepare(sql).first()) || {}
    const w = await one("SELECT SUM(status='pending') AS pending, SUM(status='approved') AS approved, SUM(status='rejected') AS rejected, COALESCE(SUM(CASE WHEN status='approved' THEN usd_cents END),0) AS paidCents, COALESCE(SUM(CASE WHEN status='pending' THEN usd_cents END),0) AS pendingCents FROM withdrawals")
    const d = await one("SELECT COUNT(*) AS n, COALESCE(SUM(coins),0) AS coins, COALESCE(SUM(CASE WHEN asset IN ('SEND','WALLET','XROCKET') THEN stars END),0) AS cents, COALESCE(SUM(CASE WHEN asset='STARS' THEN stars END),0) AS stars FROM deposits WHERE status='credited' AND asset NOT IN ('REF','REFUND')")
    const p = await one('SELECT COUNT(*) AS n, COALESCE(SUM(staked),0) AS staked, COALESCE(SUM(won),0) AS won FROM players')
    return json(env, req, { withdrawals: w, deposits: d, players: p, config: { ...wconf(env), github: !!(env.GITHUB_TOKEN && env.DATA_REPO) } })
  }
  if (path === '/withdrawals' && req.method === 'GET') {
    const st = q.get('status')
    const { results } = await env.DB.prepare(`SELECT w.*, p.name, p.username FROM withdrawals w LEFT JOIN players p ON p.tg_id = w.tg_id ${st ? 'WHERE w.status = ?' : ''} ORDER BY w.created_at DESC LIMIT ?`).bind(...(st ? [st, lim] : [lim])).all()
    return json(env, req, results.map(w => ({ ...w, stars: wstars(env, w) })))
  }
  const dm = path.match(/^\/withdrawals\/(wd-[a-z0-9]{8})$/)
  if (dm && req.method === 'POST') {
    let b = {}; try { b = await req.json() } catch { /* пусто */ }
    const action = b.action, note = cleanName(b.note, 300), txid = cleanName(b.txid, 120)
    if (action !== 'approve' && action !== 'reject') return json(env, req, { error: 'action' }, 400)
    const w = await env.DB.prepare('SELECT * FROM withdrawals WHERE id = ?').bind(dm[1]).first()
    if (!w) return json(env, req, { error: 'not found' }, 404)
    // решение принимается один раз: UPDATE с условием статуса
    const r = await env.DB.prepare("UPDATE withdrawals SET status = ?, decided_at = ?, admin_note = ?, txid = ? WHERE id = ? AND status = 'pending'").bind(action === 'approve' ? 'approved' : 'rejected', Date.now(), note, txid, w.id).run()
    if (r.meta.changes !== 1) return json(env, req, { error: 'Заявка уже обработана', status: w.status }, 409)
    if (action === 'reject') {
      // возврат монет игроку: тот же канал, что у пополнений (игра заберёт их через claim один раз)
      await env.DB.prepare("INSERT OR IGNORE INTO deposits (memo, tg_id, asset, stars, rate, status, paid, coins, created_at, expires_at, credited_at) VALUES (?, ?, 'REFUND', 0, 1, 'credited', 0, ?, ?, ?, ?)").bind('rf-' + w.id, w.tg_id, w.coins, Date.now(), Date.now(), Date.now()).run()
    }
    await plog(env, action === 'approve' ? 'withdraw_approved' : 'withdraw_rejected', w.id, { tg: w.tg_id, coins: w.coins, usd: w.usd_cents / 100, note, txid })
    defer(mirrorPlayer(env, w.tg_id, true))
    return json(env, req, { ok: true, status: action === 'approve' ? 'approved' : 'rejected' })
  }
  if (path === '/players' && req.method === 'GET') {
    const term = (q.get('q') || '').trim(), like = `%${term.replace(/[%_]/g, '')}%`
    const sort = { last: 'p.last_seen', deposited: 'dep', staked: 'p.staked', pnl: 'pnl', withdrawn: 'wd', balance: 'p.balance' }[q.get('sort') || 'last'] || 'p.last_seen'
    const { results } = await env.DB.prepare(`SELECT p.tg_id, p.name, p.username, p.first_seen, p.last_seen, p.balance, p.level, p.rounds, p.staked, p.won, p.won - p.staked AS pnl,
        COALESCE((SELECT SUM(coins) FROM deposits d WHERE d.tg_id = p.tg_id AND d.status='credited' AND d.asset NOT IN ('REF','REFUND')), 0) AS dep,
        COALESCE((SELECT SUM(coins) FROM withdrawals w WHERE w.tg_id = p.tg_id AND w.status='approved'), 0) AS wd,
        (SELECT COUNT(*) FROM withdrawals w WHERE w.tg_id = p.tg_id AND w.status='pending') AS wd_pending
      FROM players p ${term ? 'WHERE p.tg_id LIKE ? OR p.name LIKE ? OR p.username LIKE ?' : ''} ORDER BY ${sort} DESC LIMIT ?`).bind(...(term ? [like, like, like, lim] : [lim])).all()
    return json(env, req, results)
  }
  const pm = path.match(/^\/players\/(\d{1,20})$/)
  if (pm && req.method === 'GET') { const d = await playerDossier(env, pm[1], q.get('full') ? 50000 : Math.min(lim, 500)); return d ? json(env, req, d) : json(env, req, { error: 'not found' }, 404) }
  if (pm && req.method === 'POST') { // заметка админа об игроке
    let b = {}; try { b = await req.json() } catch { /* пусто */ }
    await env.DB.prepare('UPDATE players SET note = ? WHERE tg_id = ?').bind(cleanName(b.note, 500), pm[1]).run()
    return json(env, req, { ok: true })
  }
  if (path === '/deposits' && req.method === 'GET') {
    const { results } = await env.DB.prepare("SELECT d.memo, d.tg_id, d.asset, d.stars, d.coins, d.credited_at, p.name, p.username FROM deposits d LEFT JOIN players p ON p.tg_id = d.tg_id WHERE d.status = 'credited' AND d.asset NOT IN ('REF','REFUND') ORDER BY d.credited_at DESC LIMIT ?").bind(lim).all()
    return json(env, req, results.map(d => ({ ...d, amount: d.asset === 'STARS' ? `${d.stars} Stars` : `${(d.stars / 100).toFixed(2)} USD` })))
  }
  if (path === '/mirror' && req.method === 'POST') { // принудительно записать профили в GitHub
    const { results } = await env.DB.prepare('SELECT tg_id FROM players ORDER BY last_seen DESC LIMIT 40').all()
    for (const r of results) await mirrorPlayer(env, r.tg_id, true)
    return json(env, req, { ok: true, count: results.length })
  }
  return json(env, req, { error: 'not found' }, 404)
}

// ---------- служебное ----------
const isAdmin = (env, req) => !!env.ADMIN_KEY && sameStr(req.headers.get('authorization') || '', `Bearer ${env.ADMIN_KEY}`)

export default {
  async fetch(req, env, ctx) {
    CTX = ctx
    const url = new URL(req.url), path = url.pathname
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env, req) })
    try {
      await ensureSchema(env)
      if (path === '/api/deposit/config' && req.method === 'GET') {
        const c = conf(env)
        return json(env, req, { enabled: true, address: '', coinsPerTon: 0, minTon: 0, maxTon: 0, ttlMin: c.ttlMs / 60_000, usdt: { min: 1, max: 1, coinsPerUsdt: 0 }, stars: { enabled: !!env.BOT_TOKEN, min: c.min, max: c.max, coinsPerStar: c.rate }, crypto: { SEND: providerOn(env, 'SEND'), WALLET: providerOn(env, 'WALLET'), XROCKET: providerOn(env, 'XROCKET'), minUsd: c.usdMin, maxUsd: c.usdMax, coinsPerUsd: c.coinsPerUsd }, withdraw: wconf(env) })
      }
      if (path === '/api/deposit/stars' && req.method === 'POST') return await createStars(env, req)
      if (path === '/api/deposit/crypto' && req.method === 'POST') return await createCrypto(env, req)
      if (path === '/api/sync' && req.method === 'POST') return await syncEvents(env, req)
      if (path === '/api/withdraw' && req.method === 'POST') return await createWithdrawal(env, req)
      if (path === '/api/withdraw/mine' && req.method === 'GET') return await myWithdrawals(env, req)
      if (path.startsWith('/admin/api/')) return await adminApi(env, req, url)
      const pw = path.match(/^\/pay\/(send|wallet|xrocket)\/([A-Za-z0-9_-]{8,128})$/)
      if (pw && req.method === 'POST') return await providerWebhook(env, req, pw[1].toUpperCase(), pw[2], path)
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
