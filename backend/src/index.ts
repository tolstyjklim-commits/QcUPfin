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
  const user = await prisma.user.upsert({
    where: { telegramId: String(tg.id) },
    update: { username: tg.username, firstName: tg.first_name, photoUrl: tg.photo_url },
    create: {
      telegramId: String(tg.id), username: tg.username, firstName: tg.first_name,
      photoUrl: tg.photo_url, wallet: { create: { balance: 0n } },
    },
    include: { wallet: true },
  })
  res.json({
    id: user.id, telegramId: user.telegramId, username: user.username,
    firstName: user.firstName, balance: user.wallet?.balance.toString() ?? '0',
    currency: user.wallet?.currency ?? 'QCP',
  })
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
