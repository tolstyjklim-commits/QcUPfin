// Импорт настоящих подарков Telegram в игру.
// Запуск (Node 18+):
//   Windows (cmd):  set TELEGRAM_BOT_TOKEN=123:ABC && node scripts/import-gifts.mjs
//   PowerShell:     $env:TELEGRAM_BOT_TOKEN="123:ABC"; node scripts/import-gifts.mjs
//   macOS/Linux:    TELEGRAM_BOT_TOKEN=123:ABC node scripts/import-gifts.mjs
// Результат: public/gifts/catalog.json и картинки public/gifts/<id>.<ext>.
// Токен нигде не сохраняется. Игра сама подхватит каталог при следующей загрузке.
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const token = process.env.TELEGRAM_BOT_TOKEN
if (!token) { console.error('Задай переменную TELEGRAM_BOT_TOKEN (токен бота из @BotFather).'); process.exit(1) }
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'gifts')
const api = (m, q = '') => fetch(`https://api.telegram.org/bot${token}/${m}${q}`).then(r => r.json())

const res = await api('getAvailableGifts')
if (!res.ok) { console.error('Telegram ответил ошибкой:', res.description || res); process.exit(1) }
await mkdir(out, { recursive: true })

const list = res.result.gifts
console.log(`Найдено подарков: ${list.length}`)
const gifts = []
let withThumb = 0
for (const g of list) {
  const st = g.sticker || {}
  // миниатюра стикера; если её нет, а стикер статичный — сам стикер
  const fileId = st.thumbnail?.file_id || (!st.is_animated && !st.is_video ? st.file_id : null)
  let thumb = null
  if (fileId) {
    try {
      const f = await api('getFile', `?file_id=${encodeURIComponent(fileId)}`)
      if (f.ok) {
        const ext = path.extname(f.result.file_path) || '.webp'
        const bin = await fetch(`https://api.telegram.org/file/bot${token}/${f.result.file_path}`)
        await writeFile(path.join(out, `${g.id}${ext}`), Buffer.from(await bin.arrayBuffer()))
        thumb = `${g.id}${ext}`; withThumb++
      }
    } catch (e) { console.warn(`Картинка ${g.id} не скачалась:`, e.message) }
  }
  // анимированный стикер (.tgs) для крупных иконок
  let anim = null
  if (st.is_animated && st.file_id) {
    try {
      const f = await api('getFile', `?file_id=${encodeURIComponent(st.file_id)}`)
      if (f.ok) {
        const bin = await fetch(`https://api.telegram.org/file/bot${token}/${f.result.file_path}`)
        await writeFile(path.join(out, `${g.id}.tgs`), Buffer.from(await bin.arrayBuffer()))
        anim = `${g.id}.tgs`
      }
    } catch (e) { console.warn(`Анимация ${g.id} не скачалась:`, e.message) }
  }
  gifts.push({
    id: String(g.id), anim, stars: g.star_count, emoji: st.emoji || '🎁',
    total: g.total_count ?? null, remaining: g.remaining_count ?? null,
    upgradeStars: g.upgrade_star_count ?? null, thumb,
  })
}
gifts.sort((a, b) => a.stars - b.stars)
await writeFile(path.join(out, 'catalog.json'), JSON.stringify({ updated: new Date().toISOString(), gifts }, null, 2))
console.log(`Готово: ${gifts.length} подарков, картинок: ${withThumb}. Файл: public/gifts/catalog.json`)
