// Автовыгрузка подарков Telegram: при старте бэкенда (и затем раз в 30 минут) берём список
// через Bot API, скачиваем иконки/анимации в backend/cache/gifts и отдаём их с нашего домена.
// Токен бота наружу не попадает: фронтенд получает только ссылки на скачанные файлы.
import { mkdir, writeFile, access, copyFile } from 'node:fs/promises'
import path from 'node:path'
import type { Express } from 'express'
import express from 'express'

export type CatalogGift = {
  id: string; stars: number; emoji: string; total: number | null; remaining: number | null
  upgradeStars: number | null; thumb: string | null; anim: string | null
}
type Catalog = { updated: string; gifts: CatalogGift[] }

const DIR = path.resolve(process.cwd(), 'cache', 'gifts')
let catalog: Catalog | null = null
let lastError = ''
let inflight: Promise<void> | null = null

const tokenOf = () => {
  const t = process.env.TELEGRAM_BOT_TOKEN
  return t && t !== 'replace_me' ? t : null
}
const exists = (p: string) => access(p).then(() => true, () => false)

async function tg<T>(token: string, method: string, query = ''): Promise<T> {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}${query}`)
  const j = (await r.json()) as { ok: boolean; result: T; description?: string }
  if (!j.ok) throw new Error(j.description || `Telegram ${method} failed`)
  return j.result
}
async function saveFile(token: string, fileId: string, name: (ext: string) => string): Promise<string | null> {
  try {
    const f = await tg<{ file_path: string }>(token, 'getFile', `?file_id=${encodeURIComponent(fileId)}`)
    const file = name(path.extname(f.file_path) || '.webp')
    const target = path.join(DIR, file)
    if (!(await exists(target))) {
      const bin = await fetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`)
      if (!bin.ok) return null
      await writeFile(target, Buffer.from(await bin.arrayBuffer()))
    }
    return file
  } catch { return null }
}

type TgGift = {
  id: string; star_count: number; total_count?: number; remaining_count?: number; upgrade_star_count?: number
  sticker?: { file_id: string; emoji?: string; is_animated?: boolean; is_video?: boolean; thumbnail?: { file_id: string } }
}

// Один общий запуск: если синхронизация уже идёт, все запросы ждут её же, а не получают пустой ответ
export function syncGifts(): Promise<void> {
  if (!tokenOf()) return Promise.resolve()
  return (inflight ||= doSync().finally(() => { inflight = null }))
}
async function doSync(): Promise<void> {
  const token = tokenOf()!
  try {
    await mkdir(DIR, { recursive: true })
    const { gifts } = await tg<{ gifts: TgGift[] }>(token, 'getAvailableGifts')
    const out: CatalogGift[] = []
    for (const g of gifts) {
      const st = g.sticker
      const thumbId = st?.thumbnail?.file_id || (st && !st.is_animated && !st.is_video ? st.file_id : null)
      const thumb = thumbId ? await saveFile(token, thumbId, ext => `${g.id}${ext}`) : null
      const anim = st?.is_animated ? await saveFile(token, st.file_id, () => `${g.id}.tgs`) : null
      out.push({
        id: String(g.id), stars: g.star_count, emoji: st?.emoji || '🎁',
        total: g.total_count ?? null, remaining: g.remaining_count ?? null,
        upgradeStars: g.upgrade_star_count ?? null, thumb, anim,
      })
    }
    out.sort((a, b) => a.stars - b.stars)
    catalog = { updated: new Date().toISOString(), gifts: out }
    lastError = ''
    await exportToFrontend(catalog).catch(e => console.warn('[gifts] не удалось обновить каталог игры:', (e as Error).message))
    console.log(`[gifts] синхронизировано подарков Telegram: ${out.length}`)
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e)
    console.warn('[gifts] ошибка синхронизации:', lastError)
  }
}

// Кладём свежий каталог и картинки прямо в игру (frontend/public/gifts): она показывает их сразу, даже до ответа бэкенда
async function exportToFrontend(c: Catalog) {
  const dir = process.env.PUBLIC_GIFTS_DIR || path.resolve(process.cwd(), '..', 'frontend', 'public', 'gifts')
  if (!(await exists(dir))) return
  for (const g of c.gifts) for (const f of [g.thumb, g.anim]) if (f) await copyFile(path.join(DIR, f), path.join(dir, f))
  await writeFile(path.join(dir, 'catalog.json'), JSON.stringify({ updated: c.updated, gifts: c.gifts }, null, 1))
}

export function mountGifts(app: Express) {
  app.use('/gifts-assets', express.static(DIR, { maxAge: '1h' }))
  app.get('/api/gifts/catalog', async (_req, res) => {
    if (!tokenOf()) return res.status(503).json({ error: 'TELEGRAM_BOT_TOKEN is not set' })
    if (!catalog) await syncGifts()
    if (!catalog) return res.status(502).json({ error: lastError || 'Telegram API unavailable' })
    res.json({
      updated: catalog.updated,
      gifts: catalog.gifts.map(g => ({
        ...g,
        thumb: g.thumb ? `/gifts-assets/${g.thumb}` : null,
        anim: g.anim ? `/gifts-assets/${g.anim}` : null,
      })),
    })
  })
  if (tokenOf()) {
    void syncGifts()
    setInterval(() => void syncGifts(), 30 * 60_000).unref()
  } else console.log('[gifts] TELEGRAM_BOT_TOKEN не задан: автовыгрузка подарков выключена')
}
