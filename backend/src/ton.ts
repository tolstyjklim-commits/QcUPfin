// Приём TON: пользователь переводит на ваш адрес с уникальным комментарием (memo),
// сервер раз в несколько секунд читает входящие транзакции через toncenter и зачисляет монеты.
// Работает на обычном VPS: нужен только исходящий доступ к toncenter.com, вебхуки и публичный адрес не нужны.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Express } from 'express'
import type { PrismaClient } from '@prisma/client'
import { requireTelegramAuth } from './telegram.js'

const NANO = 1_000_000_000n

// ---------------------------------------------------------------------------------------------
// Журнал платежей: по одной JSON-строке на событие, в консоль и в файл (по умолчанию logs/payments.jsonl, меняется PAY_LOG_FILE=путь,
// отключается PAY_LOG_FILE=off). Секреты (токен бота, ключи API) и персональные данные в журнал не попадают, только внутренние id и memo.
// События: deposit_created, deposit_credited, deposit_rejected, duplicate_tx, dust_ignored, stars_precheckout, stars_paid, stars_orphan, invoice_failed, poll_error, rates_fallback, mount.
// Быстро найти всё по заявке:  grep qc-xxxxxxxxxxxx logs/payments.jsonl
// ---------------------------------------------------------------------------------------------
const LOG_FILE = process.env.PAY_LOG_FILE === 'off' ? '' : (process.env.PAY_LOG_FILE || 'logs/payments.jsonl')
let logReady = false
function plog(event: string, data: Record<string, unknown> = {}, level: 'info' | 'warn' = 'info') {
  const line = JSON.stringify({ t: new Date().toISOString(), event, ...data }, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
  ;(level === 'warn' ? console.warn : console.log)(`[pay] ${line}`)
  if (!LOG_FILE) return
  try {
    if (!logReady) { fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true }); logReady = true }
    fs.appendFile(LOG_FILE, line + '\n', () => { /* журнал не должен ронять платёж */ })
  } catch { /* то же самое */ }
}
const cfg = () => ({
  address: process.env.TON_DEPOSIT_ADDRESS || '',
  apiUrl: (process.env.TONCENTER_URL || 'https://toncenter.com/api/v2').replace(/\/$/, ''),
  apiKey: process.env.TONCENTER_API_KEY || '',
  coinsPerTon: Number(process.env.COINS_PER_TON || 150),
  minTon: Number(process.env.MIN_DEPOSIT_TON || 0.1),
  maxTon: Number(process.env.MAX_DEPOSIT_TON || 1000),
  ttlMin: Number(process.env.DEPOSIT_TTL_MIN || 60),
  pollMs: Number(process.env.TON_POLL_MS || 10_000),
  coinsPerUsdt: Number(process.env.COINS_PER_USDT || 100),
  minUsdt: Number(process.env.MIN_DEPOSIT_USDT || 1),
  maxUsdt: Number(process.env.MAX_DEPOSIT_USDT || 5000),
  usdtMaster: process.env.USDT_JETTON_MASTER || 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs', // USDT в сети TON
  v3Url: (process.env.TONCENTER_V3_URL || 'https://toncenter.com/api/v3').replace(/\/$/, ''),
  // Telegram Stars (валюта XTR): 1 Star = coinsPerStar монет игры (по умолчанию 1:1). Нужен токен бота, тот же, что у мини-приложения.
  botToken: process.env.STARS_BOT_TOKEN || process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '',
  coinsPerStar: Number(process.env.COINS_PER_STAR || 1),
  minStars: Number(process.env.MIN_DEPOSIT_STARS || 10),
  maxStars: Number(process.env.MAX_DEPOSIT_STARS || 100_000),
})

// 1 монета = 1 Star. Star в USDT: публичный API по сделкам Fragment; TON/USD: CoinGecko. Кэш 1 минута, запасные значения из .env
let rateCache: { ton: number; usdt: number; at: number } | null = null
async function liveRates() {
  const c = cfg()
  if (rateCache && Date.now() - rateCache.at < 60_000) return rateCache
  let starUsd = Number(process.env.STAR_USD || 0.015), tonUsd = Number(process.env.TON_USD || 0)
  const ref = starUsd
  // внешний API не должен сам задавать курс без границ: сбой или подмена дали бы игрокам звёзды почти даром.
  // Цена Star принимается, только если она в пределах от 1/3 до 3 запасной цены; цена TON: от $0,05 до $5000
  try { const j: any = await (await fetch('https://bes-dev.github.io/telegram_stars_rates/api.json', { signal: AbortSignal.timeout(10_000) })).json(); const v = Number(j.usdt_per_star); if (v >= ref / 3 && v <= ref * 3) starUsd = v; else plog('rates_fallback', { what: 'star', got: j.usdt_per_star, fallback: ref }, 'warn') } catch { plog('rates_fallback', { what: 'star', error: 'api' }, 'warn') }
  try { const j: any = await (await fetch('https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd', { signal: AbortSignal.timeout(10_000) })).json(); const v = Number(j['the-open-network']?.usd); if (v >= 0.05 && v <= 5000) tonUsd = v; else plog('rates_fallback', { what: 'ton', got: j['the-open-network']?.usd, fallback: tonUsd }, 'warn') } catch { plog('rates_fallback', { what: 'ton', error: 'api' }, 'warn') }
  rateCache = { ton: tonUsd > 0 ? Math.floor(tonUsd / starUsd) : c.coinsPerTon, usdt: Math.floor(1 / starUsd), at: Date.now() }
  return rateCache
}

const toNano = (ton: number) => BigInt(Math.round(ton * 1e9))
const coinsFor = (nano: bigint, perTon: number) => (nano * BigInt(Math.round(perTon * 100))) / (NANO * 100n)

type TonTx = { utime?: number; transaction_id?: { hash?: string }; in_msg?: { source?: string; value?: string; message?: string } }

async function fetchIncoming(): Promise<TonTx[]> {
  const c = cfg()
  const r = await fetch(`${c.apiUrl}/getTransactions?address=${encodeURIComponent(c.address)}&limit=50&archival=true`, {
    headers: c.apiKey ? { 'X-API-Key': c.apiKey } : {}, signal: AbortSignal.timeout(15_000),
  })
  if (!r.ok) throw new Error(`toncenter ${r.status}`)
  const j = (await r.json()) as { ok: boolean; result?: TonTx[]; error?: string }
  if (!j.ok) throw new Error(j.error || 'toncenter error')
  return j.result || []
}

const SKEW_MS = 120_000 // допуск на расхождение часов
const warned = new Set<string>()
type Dep = { id: string; userId: string; memo: string; status: string; asset: string; rate: number | null; expiresAt: Date }

// whenMs: время перевода в блокчейне. Для TON и USDT платёж засчитывается, только если он сделан внутри окна заявки:
// иначе старый перевод с такой же суммой закрывал бы новую заявку, а опоздавший платёж шёл бы по давно устаревшему курсу.
// Для Stars времени нет: деньги уже списаны Telegram, поэтому зачисляем в любом случае.
async function credit(prisma: PrismaClient, dep: Dep | null, paid: bigint, hash: string, whenMs?: number) {
  const c = cfg()
  if (!dep || dep.status === 'credited' || paid <= 0n || !hash) return
  if (whenMs !== undefined) {
    const exp = dep.expiresAt.getTime()
    if (!(whenMs >= exp - c.ttlMin * 60_000 - SKEW_MS && whenMs <= exp + SKEW_MS)) {
      if (!warned.has(hash)) { warned.add(hash); plog('deposit_rejected', { reason: 'вне окна заявки, разберите вручную', memo: dep.memo, asset: dep.asset, tx: hash, paid, txTime: new Date(whenMs).toISOString(), expiresAt: dep.expiresAt }, 'warn') }
      return
    }
  }
  const r = dep.rate ?? (dep.asset === 'STARS' ? c.coinsPerStar : dep.asset === 'USDT' ? c.coinsPerUsdt : c.coinsPerTon)
  const coins = dep.asset === 'STARS' ? (paid * BigInt(Math.round(r * 100))) / 100n
    : dep.asset === 'USDT' ? (paid * BigInt(Math.round(r * 100))) / (1_000_000n * 100n) : coinsFor(paid, r)
  if (coins <= 0n) { if (!warned.has(hash)) { warned.add(hash); plog('dust_ignored', { memo: dep.memo, asset: dep.asset, tx: hash, paid }, 'warn') } return } // пылевой платёж: заявку не закрываем
  const ok = await prisma.$transaction(async tx => {
    // один и тот же перевод не может закрыть две заявки
    if (await tx.deposit.findFirst({ where: { txHash: hash } })) { if (!warned.has(hash)) { warned.add(hash); plog('duplicate_tx', { memo: dep.memo, tx: hash }, 'warn') } return false }
    // updateMany с условием status != credited: второй параллельный проход ничего не обновит
    const done = await tx.deposit.updateMany({
      where: { id: dep.id, status: { not: 'credited' } },
      data: { status: 'credited', paidNano: paid, coins, txHash: hash, creditedAt: new Date() },
    })
    if (done.count !== 1) return false
    await tx.wallet.update({ where: { userId: dep.userId }, data: { balance: { increment: coins } } })
    await tx.transaction.create({ data: { userId: dep.userId, amount: coins, type: dep.asset === 'STARS' ? 'deposit_stars' : dep.asset === 'USDT' ? 'deposit_usdt' : 'deposit_ton', status: 'done', description: dep.asset === 'STARS' ? `Stars ${paid}` : dep.asset === 'USDT' ? `USDT ${Number(paid) / 1e6}` : `TON ${Number(paid) / 1e9}` } })
    return true
  })
  if (ok) plog('deposit_credited', { memo: dep.memo, asset: dep.asset, userId: dep.userId, paid, coins, rate: r, tx: hash })
}

// Адрес вида EQ…/UQ… -> «сырой» 0:hex, как отдаёт toncenter v3
function toRaw(a: string): string {
  if (/^-?\d+:[0-9a-fA-F]{64}$/.test(a)) return a.toLowerCase()
  const b = Buffer.from(a.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return b.length === 36 ? `${(b[1] === 0xff ? -1 : b[1])}:${b.subarray(2, 34).toString('hex')}` : a
}

// USDT (jetton): у переводов нет надёжного комментария, поэтому платёж опознаётся по уникальной сумме
async function pollUsdt(prisma: PrismaClient) {
  const c = cfg()
  const r = await fetch(`${c.v3Url}/jetton/transfers?owner_address=${encodeURIComponent(c.address)}&direction=in&limit=50&sort=desc`, {
    headers: c.apiKey ? { 'X-API-Key': c.apiKey } : {}, signal: AbortSignal.timeout(15_000),
  })
  if (!r.ok) throw new Error(`toncenter v3 ${r.status}`)
  const j = (await r.json()) as { jetton_transfers?: { transaction_hash: string; amount: string; jetton_master: string; transaction_now?: number; transaction_aborted?: boolean }[] }
  const master = toRaw(c.usdtMaster)
  for (const t of j.jetton_transfers || []) {
    if (t.transaction_aborted || toRaw(t.jetton_master) !== master) continue
    const paid = BigInt(t.amount)
    const dep = await prisma.deposit.findFirst({ where: { asset: 'USDT', status: 'pending', amountNano: paid, expiresAt: { gt: new Date(Date.now() - 10 * 60_000) } } })
    await credit(prisma, dep, paid, t.transaction_hash, (t.transaction_now ?? 0) * 1000)
  }
}

async function pollOnce(prisma: PrismaClient) {
  for (const t of await fetchIncoming()) {
    const m = t.in_msg
    const hash = t.transaction_id?.hash
    if (!m?.source || !m.message || !hash) continue // исходящие и переводы без комментария пропускаем
    const memo = m.message.trim()
    if (!/^qc-[a-z0-9]{12}$/.test(memo)) continue
    const dep = await prisma.deposit.findUnique({ where: { memo } })
    if (dep && dep.asset !== 'TON') { if (!warned.has(hash)) { warned.add(hash); plog('deposit_rejected', { reason: 'memo чужого способа пришёл по TON', memo, asset: dep.asset, tx: hash, value: m.value }, 'warn') } continue } // memo чужого способа (USDT, Stars) по TON не зачисляется: иначе наноTON считались бы за звёзды
    await credit(prisma, dep, BigInt(m.value || '0'), hash, (t.utime ?? 0) * 1000)
  }
  await pollUsdt(prisma)
  // заявка закрывается с запасом в 10 минут: платёж, сделанный в последние секунды окна, успеет определиться
  await prisma.deposit.updateMany({ where: { status: 'pending', expiresAt: { lt: new Date(Date.now() - 10 * 60_000) } }, data: { status: 'expired' } })
}

// ---------------------------------------------------------------------------------------------
// Telegram Stars. Игрок платит счётом внутри Telegram, зачисляет только сервер:
//  1) POST /api/deposit/stars создаёт заявку (memo) и ссылку на счёт (createInvoiceLink, валюта XTR, payload = memo);
//  2) Telegram перед списанием присылает боту pre_checkout_query: отвечаем «да» только если заявка живая, принадлежит этому игроку и сумма та же;
//  3) после списания приходит successful_payment: зачисляем ⭐ один раз (номер платежа Telegram записывается как txHash, повтор не пройдёт).
// Как и TON, работает на обычном VPS без вебхуков: бот читает обновления сам (getUpdates).
// Важно: на одного бота должен быть ОДИН потребитель обновлений. Если у бота уже включён вебхук или другой getUpdates, будет ошибка 409.
// ---------------------------------------------------------------------------------------------
async function tg<T = any>(method: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`https://api.telegram.org/bot${cfg().botToken}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
  const j = (await r.json()) as { ok: boolean; result?: T; description?: string }
  if (!j.ok) throw new Error(`telegram ${method}: ${j.description || r.status}`)
  return j.result as T
}

type TgUpdate = {
  update_id: number
  pre_checkout_query?: { id: string; from: { id: number }; currency: string; total_amount: number; invoice_payload: string }
  message?: { from?: { id: number }; successful_payment?: { currency: string; total_amount: number; invoice_payload: string; telegram_payment_charge_id: string } }
}

async function handleStarsUpdate(prisma: PrismaClient, u: TgUpdate) {
  const q = u.pre_checkout_query
  if (q) {
    const dep = await prisma.deposit.findUnique({ where: { memo: q.invoice_payload }, include: { user: true } })
    const ok = !!dep && dep.asset === 'STARS' && dep.status === 'pending' && dep.expiresAt > new Date() && q.currency === 'XTR'
      && BigInt(q.total_amount) === dep.amountNano && dep.user.telegramId === String(q.from.id)
    plog('stars_precheckout', { memo: q.invoice_payload, ok, stars: q.total_amount, currency: q.currency, status: dep?.status, matchedUser: dep ? dep.user.telegramId === String(q.from.id) : null }, ok ? 'info' : 'warn')
    await tg('answerPreCheckoutQuery', ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: 'Счёт недействителен или истёк. Создайте новый в игре.' })
    return
  }
  const pay = u.message?.successful_payment
  if (pay && pay.currency === 'XTR') {
    const dep = await prisma.deposit.findUnique({ where: { memo: pay.invoice_payload }, include: { user: true } })
    // деньги уже списаны, поэтому зачисляем даже если заявка успела истечь; проверяем только, что платил её владелец
    if (!dep || dep.asset !== 'STARS' || dep.user.telegramId !== String(u.message?.from?.id)) { plog('stars_orphan', { memo: pay.invoice_payload, tx: pay.telegram_payment_charge_id, stars: pay.total_amount, reason: 'нет заявки или платил не её владелец: деньги списаны, разберите вручную' }, 'warn'); return }
    plog('stars_paid', { memo: pay.invoice_payload, tx: pay.telegram_payment_charge_id, stars: pay.total_amount })
    if (BigInt(pay.total_amount) !== dep.amountNano) plog('deposit_rejected', { reason: 'сумма платежа не равна счёту, зачисляем фактическую', memo: dep.memo, expected: dep.amountNano, got: pay.total_amount }, 'warn')
    await credit(prisma, dep, BigInt(pay.total_amount), pay.telegram_payment_charge_id)
  }
}

function mountStars(app: Express, prisma: PrismaClient) {
  const c = cfg()
  if (!c.botToken) { plog('mount', { what: 'stars', enabled: false, reason: 'токен бота не задан (BOT_TOKEN)' }); return }
  let offset = 0
  let busy = false
  const loop = async () => {
    if (busy) return
    busy = true
    try {
      const ups = await tg<TgUpdate[]>('getUpdates', { offset, timeout: 0, allowed_updates: ['pre_checkout_query', 'message'] })
      for (const u of ups) {
        // offset двигаем только после обработки: если зачисление упало, Telegram пришлёт обновление снова (зачисление идемпотентно)
        await handleStarsUpdate(prisma, u)
        offset = u.update_id + 1
      }
    } catch (e) { plog('poll_error', { what: 'stars', error: (e as Error).message }, 'warn') } finally { busy = false }
  }
  // pre_checkout_query нужно подтвердить за 10 секунд, поэтому опрашиваем часто
  setInterval(loop, 1500)
  plog('mount', { what: 'stars', enabled: true })

  app.post('/api/deposit/stars', requireTelegramAuth, async (req, res) => {
    const k = cfg()
    const tgUser = req.telegramUser!
    const stars = Number(req.body?.stars)
    if (!Number.isInteger(stars) || stars < k.minStars || stars > k.maxStars) return res.status(400).json({ error: `Сумма от ${k.minStars} до ${k.maxStars} Stars, целым числом` })
    const user = await prisma.user.upsert({
      where: { telegramId: String(tgUser.id) },
      update: {},
      create: { telegramId: String(tgUser.id), username: tgUser.username, firstName: tgUser.first_name, photoUrl: tgUser.photo_url, wallet: { create: { balance: 0n } } },
    })
    const pending = await prisma.deposit.count({ where: { userId: user.id, status: 'pending', expiresAt: { gt: new Date() } } })
    if (pending >= 5) { plog('deposit_rejected', { reason: 'слишком много незавершённых', asset: 'STARS', userId: user.id }, 'warn'); return res.status(429).json({ error: 'Слишком много незавершённых пополнений, подожди или оплати существующие' }) }
    const memo = 'qc-' + crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(12, '0').slice(0, 12)
    const dep = await prisma.deposit.create({
      data: { userId: user.id, asset: 'STARS', memo, amountNano: BigInt(stars), rate: k.coinsPerStar, expiresAt: new Date(Date.now() + k.ttlMin * 60_000) },
    })
    try {
      const coins = Math.floor(stars * k.coinsPerStar)
      const invoiceLink = await tg<string>('createInvoiceLink', {
        title: `${coins} ⭐ для QcUp`, description: `Пополнение баланса игры на ${coins} ⭐`, payload: memo,
        currency: 'XTR', prices: [{ label: `${coins} ⭐`, amount: stars }],
      })
      plog('deposit_created', { asset: 'STARS', memo, userId: user.id, stars, coins, expiresAt: dep.expiresAt })
      res.json({ memo, stars, coins, invoiceLink, expiresAt: dep.expiresAt })
    } catch (e) {
      await prisma.deposit.update({ where: { id: dep.id }, data: { status: 'expired' } })
      plog('invoice_failed', { memo, error: (e as Error).message }, 'warn')
      res.status(502).json({ error: 'Не удалось создать счёт, попробуйте позже' })
    }
  })
}

export const starsInfo = () => { const k = cfg(); return { enabled: !!k.botToken, min: k.minStars, max: k.maxStars, coinsPerStar: k.coinsPerStar } }

export function mountTon(app: Express, prisma: PrismaClient) {
  const c = cfg()
  mountStars(app, prisma)
  // maxTon/ttl нужны окну пополнения даже без TON: отдаём настройки, чтобы работали одни только Stars
  if (!c.address) {
    plog('mount', { what: 'ton', enabled: false, reason: 'TON_DEPOSIT_ADDRESS не задан' })
    app.get('/api/deposit/config', (_req, res) => { const k = cfg(); res.json({ enabled: true, address: '', coinsPerTon: k.coinsPerTon, minTon: k.minTon, maxTon: k.maxTon, ttlMin: k.ttlMin, stars: starsInfo() }) })
    app.get('/api/deposit/ton/:memo', requireTelegramAuth, async (req, res) => {
      const dep = await prisma.deposit.findUnique({ where: { memo: req.params.memo }, include: { user: true } })
      if (!dep || dep.user.telegramId !== String(req.telegramUser!.id)) return res.status(404).json({ error: 'not found' })
      res.json({ status: dep.status, coins: dep.coins?.toString() ?? null })
    })
    return
  }
  let busy = false
  setInterval(async () => {
    if (busy) return
    busy = true
    try { await pollOnce(prisma) } catch (e) { plog('poll_error', { what: 'ton', error: (e as Error).message }, 'warn') } finally { busy = false }
  }, c.pollMs)
  plog('mount', { what: 'ton', enabled: true, address: `${c.address.slice(0, 6)}…${c.address.slice(-4)}` })

  app.get('/api/deposit/config', async (_req, res) => {
    const k = cfg()
    res.json({ enabled: true, address: k.address, coinsPerTon: (await liveRates()).ton, minTon: k.minTon, maxTon: k.maxTon, ttlMin: k.ttlMin, usdt: { master: k.usdtMaster, coinsPerUsdt: (await liveRates()).usdt, min: k.minUsdt, max: k.maxUsdt }, stars: starsInfo() })
  })

  app.post('/api/deposit/ton', requireTelegramAuth, async (req, res) => {
    const k = cfg()
    const tg = req.telegramUser!
    const asset = req.body?.asset === 'USDT' ? 'USDT' : 'TON'
    const ton = Number(req.body?.amountTon)
    const usdt = Number(req.body?.amountUsdt)
    if (asset === 'TON' && (!Number.isFinite(ton) || ton < k.minTon || ton > k.maxTon)) {
      return res.status(400).json({ error: `Сумма от ${k.minTon} до ${k.maxTon} TON` })
    }
    if (asset === 'USDT' && (!Number.isFinite(usdt) || usdt < k.minUsdt || usdt > k.maxUsdt)) {
      return res.status(400).json({ error: `Сумма от ${k.minUsdt} до ${k.maxUsdt} USDT` })
    }
    const user = await prisma.user.upsert({
      where: { telegramId: String(tg.id) },
      update: {},
      create: { telegramId: String(tg.id), username: tg.username, firstName: tg.first_name, photoUrl: tg.photo_url, wallet: { create: { balance: 0n } } },
    })
    const pending = await prisma.deposit.count({ where: { userId: user.id, status: 'pending', expiresAt: { gt: new Date() } } })
    if (pending >= 5) { plog('deposit_rejected', { reason: 'слишком много незавершённых', asset, userId: user.id }, 'warn'); return res.status(429).json({ error: 'Слишком много незавершённых пополнений, подожди или оплати существующие' }) }
    const memo = 'qc-' + crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(12, '0').slice(0, 12)
    // USDT: добавляем к сумме 1..9999 микро-USDT (до $0.01), чтобы у каждого ожидающего платежа была своя точная сумма
    let amountNano: bigint | null = asset === 'TON' ? toNano(ton) : null
    if (asset === 'USDT') {
      const base = BigInt(Math.round(usdt * 100)) * 10_000n
      for (let i = 0; i < 20; i++) {
        const cand = base + BigInt(1 + crypto.randomInt(9999))
        if (!(await prisma.deposit.findFirst({ where: { asset: 'USDT', status: 'pending', amountNano: cand } }))) { amountNano = cand; break }
      }
      if (!amountNano) return res.status(503).json({ error: 'Попробуйте ещё раз' })
    }
    const rates = await liveRates()
    const dep = await prisma.deposit.create({
      data: { userId: user.id, asset, memo, amountNano, rate: asset === 'USDT' ? rates.usdt : rates.ton, expiresAt: new Date(Date.now() + k.ttlMin * 60_000) },
    })
    plog('deposit_created', { asset, memo, userId: user.id, amount: dep.amountNano, rate: dep.rate, expiresAt: dep.expiresAt })
    res.json({ memo: dep.memo, asset, address: k.address, amountNano: dep.amountNano?.toString() ?? null, expiresAt: dep.expiresAt, coinsPerTon: k.coinsPerTon, jettonMaster: asset === 'USDT' ? k.usdtMaster : null })
  })

  // Монеты за зачисленные платежи забирает клиент и добавляет в баланс игр; claimedAt гарантирует, что это произойдёт один раз
  app.get('/api/deposit/unclaimed', requireTelegramAuth, async (req, res) => {
    const rows = await prisma.deposit.findMany({
      where: { status: 'credited', claimedAt: null, user: { telegramId: String(req.telegramUser!.id) } },
      select: { id: true, coins: true, asset: true },
    })
    res.json(rows.map(r => ({ id: r.id, coins: r.coins?.toString() ?? '0', asset: r.asset })))
  })

  app.post('/api/deposit/claim', requireTelegramAuth, async (req, res) => {
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === 'string').slice(0, 50) : []
    let total = 0n
    for (const id of ids) {
      const dep = await prisma.deposit.findFirst({ where: { id, status: 'credited', claimedAt: null, user: { telegramId: String(req.telegramUser!.id) } } })
      if (!dep) continue
      const done = await prisma.deposit.updateMany({ where: { id, claimedAt: null }, data: { claimedAt: new Date() } })
      if (done.count === 1) total += dep.coins ?? 0n
    }
    res.json({ coins: total.toString() })
  })

  app.get('/api/deposit/ton/:memo', requireTelegramAuth, async (req, res) => {
    const dep = await prisma.deposit.findUnique({ where: { memo: req.params.memo }, include: { user: true } })
    if (!dep || dep.user.telegramId !== String(req.telegramUser!.id)) return res.status(404).json({ error: 'not found' })
    const w = await prisma.wallet.findUnique({ where: { userId: dep.userId } })
    res.json({ status: dep.status, coins: dep.coins?.toString() ?? null, balance: w?.balance.toString() ?? '0' })
  })
}
