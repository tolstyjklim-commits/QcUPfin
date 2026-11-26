import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { PrismaClient } from '@prisma/client'
import { requireTelegramAuth } from './telegram.js'
import { mountGifts } from './gifts.js'
import { startBot } from './bot.js'
import { mountTon } from './ton.js'

const app = express()
// Prisma создаём лениво: если клиент не сгенерирован, подарки и бот всё равно работают (не работает только /api/me)
let _prisma: PrismaClient | null = null
const prisma = new Proxy({} as PrismaClient, {
  get(_t, k) {
    if (!_prisma) _prisma = new PrismaClient()
    return (_prisma as never)[k as never]
  },
})
app.use(cors({ origin: process.env.FRONTEND_ORIGIN?.split(',') || true }))
app.use(express.json({ limit: '32kb' }))

app.get('/health', (_req, res) => res.json({ ok: true, service: 'qcup-api' }))

app.get('/api/me', requireTelegramAuth, async (req, res) => {
  const tg = req.telegramUser!
  // Реферал: при ПЕРВОМ входе запоминаем пригласившего из ссылки вида ?startapp=ref_<telegramId>. Себя пригласить нельзя.
  let referredById: string | undefined
  const known = await prisma.user.findUnique({ where: { telegramId: String(tg.id) }, select: { id: true } })
  const m = /^ref_(\d{1,15})$/.exec(req.startParam || '')
  if (!known && m && m[1] !== String(tg.id)) {
    const inviter = await prisma.user.findUnique({ where: { telegramId: m[1] }, select: { id: true } })
    if (inviter) referredById = inviter.id
  }
  const user = await prisma.user.upsert({
    where: { telegramId: String(tg.id) },
    update: { username: tg.username, firstName: tg.first_name, photoUrl: tg.photo_url },
    create: {
      telegramId: String(tg.id), username: tg.username, firstName: tg.first_name,
      photoUrl: tg.photo_url, wallet: { create: { balance: 0n } }, referredById,
    },
    include: { wallet: true },
  })
  res.json({
    id: user.id, telegramId: user.telegramId, username: user.username,
    firstName: user.firstName, balance: user.wallet?.balance.toString() ?? '0',
    currency: user.wallet?.currency ?? 'QCP',
  })
})

// Реферальная статистика: сколько друзей пришло по ссылке и сколько монет начислено (процент задаёт REF_PERCENT в .env, по умолчанию 5)
app.get('/api/referrals', requireTelegramAuth, async (req, res) => {
  const me = await prisma.user.findUnique({ where: { telegramId: String(req.telegramUser!.id) }, select: { id: true } })
  const percent = Number(process.env.REF_PERCENT ?? 5)
  if (!me) return res.json({ invited: 0, earned: 0, percent })
  const invited = await prisma.user.count({ where: { referredById: me.id } })
  const sum = await prisma.transaction.aggregate({ where: { userId: me.id, type: 'referral' }, _sum: { amount: true } })
  res.json({ invited, earned: Number(sum._sum.amount ?? 0n), percent })
})

// Лента выигрышей. Игры считаются в приложении, поэтому сервер не может проверить, что выигрыш настоящий: записи ограничены
// по размеру и частоте (одна в 20 секунд и не больше 30 в час с игрока), чтобы подделкой нельзя было засорить ленту.
const shortName = (u: { username?: string; first_name?: string }) => (u.username || u.first_name || 'Игрок').replace(/[<>]/g, '').slice(0, 24)
app.post('/api/feed', requireTelegramAuth, async (req, res) => {
  const tg = req.telegramUser!
  const b = (req.body || {}) as Record<string, unknown>
  const kind = b.kind === 'gift' ? 'gift' : b.kind === 'win' ? 'win' : ''
  const game = typeof b.game === 'string' ? b.game.trim().slice(0, 30) : ''
  const amount = Math.round(Number(b.amount) || 0), mult = Number(b.mult) || 0
  const gift = typeof b.gift === 'string' && /^[\w:.-]{1,64}$/.test(b.gift) ? b.gift : null
  if (!kind || !game) return res.status(400).json({ error: 'bad entry' })
  if (kind === 'win' && !(amount >= 200 && amount <= 1_000_000 && mult >= 1.5 && mult <= 1000)) return res.status(400).json({ error: 'bad win' })
  if (kind === 'gift' && !gift) return res.status(400).json({ error: 'bad gift' })
  const user = await prisma.user.findUnique({ where: { telegramId: String(tg.id) }, select: { id: true } })
  if (!user) return res.status(404).json({ error: 'no user' })
  const hourAgo = new Date(Date.now() - 3_600_000)
  const recent = await prisma.feedEntry.findMany({ where: { userId: user.id, createdAt: { gt: hourAgo } }, orderBy: { createdAt: 'desc' }, take: 30, select: { createdAt: true } })
  if (recent.length >= 30 || (recent[0] && Date.now() - recent[0].createdAt.getTime() < 20_000)) return res.status(429).json({ error: 'too often' })
  await prisma.feedEntry.create({ data: { userId: user.id, name: shortName(tg), kind, game, amount: BigInt(kind === 'win' ? amount : 0), mult: kind === 'win' ? mult : 0, gift: kind === 'gift' ? gift : null } })
  res.status(204).end()
})
app.get('/api/feed', requireTelegramAuth, async (req, res) => {
  const since = new Date(Math.max(Number(req.query.since) || 0, Date.now() - 6 * 3_600_000))
  const me = await prisma.user.findUnique({ where: { telegramId: String(req.telegramUser!.id) }, select: { id: true } })
  const rows = await prisma.feedEntry.findMany({ where: { createdAt: { gt: since } }, orderBy: { createdAt: 'asc' }, take: 20 })
  res.json(rows.map(r => ({ id: r.id, kind: r.kind, name: r.name, game: r.game, amount: Number(r.amount), mult: r.mult, gift: r.gift || undefined, at: r.createdAt.getTime(), mine: r.userId === me?.id })))
})

// Подарки Telegram: автовыгрузка при старте и раз в 30 минут (см. gifts.ts)
mountGifts(app)

// Пополнение TON и USDT: см. ton.ts и переменные в .env.example
mountTon(app, prisma)

// NFT-подарки: флор-цены коллекций в TON из Gift Asset API (нужен GIFTASSET_API_KEY). Кэш 5 минут.
// Формат ответа GiftAsset: collection_floors[коллекция] = { getgems, mrkt, portals, tonnel, last_update }.
const OPEN_FLOORS = 'https://raw.githubusercontent.com/Atlannn/telegram-gifts-floor-price/main/data/latest.json'
let nftCache: { at: number; body: { updated: string; collections: unknown[] } } | null = null
app.get('/api/nft/floors', async (_req, res) => {
  const key = process.env.GIFTASSET_API_KEY
  if (nftCache && Date.now() - nftCache.at < 5 * 60_000) return res.json({ ...nftCache.body, cached: true })
  if (!key) {
    // Без ключа: открытый датасет флор-цен Fragment (CC BY 4.0, Baltic Assets), обновляется раз в сутки
    try {
      const r = await fetch(OPEN_FLOORS)
      if (!r.ok) return res.status(502).json({ error: `open dataset responded ${r.status}` })
      const j = (await r.json()) as { date?: string; floors?: Record<string, number> }
      const tmpl = process.env.NFT_IMAGE_TEMPLATE || ''
      const collections = Object.entries(j.floors || {}).filter(([, v]) => v > 0).map(([slug, floorTon]) => ({
        id: slug, name: slug.charAt(0).toUpperCase() + slug.slice(1), floorTon, image: tmpl ? tmpl.replace('{slug}', slug) : null,
      })).sort((a, b) => a.floorTon - b.floorTon)
      const body = { updated: j.date || new Date().toISOString(), source: 'open-dataset', collections }
      nftCache = { at: Date.now(), body }
      return res.json({ ...body, cached: false })
    } catch (e) { console.warn('[nft] открытый датасет недоступен:', (e as Error).message); return res.status(502).json({ error: 'open dataset unreachable' }) }
  }
  try {
    const r = await fetch('https://giftasset.gifts/api/v1/gifts/get_gifts_price_list', { headers: { 'X-API-Key': key } })
    if (!r.ok) { console.warn(`[nft] GiftAsset ответил ${r.status}: проверь GIFTASSET_API_KEY`); return res.status(502).json({ error: `GiftAsset responded ${r.status}` }) }
    const j = (await r.json()) as { collection_floors?: Record<string, Record<string, unknown>> }
    const tmpl = process.env.NFT_IMAGE_TEMPLATE || '' // например https://nft.fragment.com/gift/{slug}-1.webp
    const collections = Object.entries(j.collection_floors || {}).flatMap(([name, v]) => {
      const prices = ['getgems', 'mrkt', 'portals', 'tonnel'].map(p => v?.[p]).filter((n): n is number => typeof n === 'number' && n > 0).sort((a, b) => a - b)
      if (!prices.length) return []
      const floorTon = prices[Math.floor(prices.length / 2)] // медиана по площадкам
      const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '')
      return [{ id: slug, name, floorTon, providers: v, image: tmpl ? tmpl.replace('{slug}', slug) : null }]
    }).sort((a, b) => a.floorTon - b.floorTon)
    const body = { updated: new Date().toISOString(), collections }
    nftCache = { at: Date.now(), body }
    res.json({ ...body, cached: false })
  } catch (e) { console.warn('[nft] GiftAsset недоступен:', (e as Error).message); res.status(502).json({ error: 'GiftAsset unreachable' }) }
})

const port = Number(process.env.API_PORT || 4000)
app.listen(port, () => console.log(`QcUp API listening on :${port}`))
startBot()
