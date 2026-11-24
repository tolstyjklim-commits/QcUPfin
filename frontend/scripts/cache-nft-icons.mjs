// Сохраняет иконки NFT-коллекций на этот компьютер (public/gifts/nft/<коллекция>.webp), чтобы игра
// не зависела от сети при показе. Качает только недостающие. Запускается лаунчером автоматически.
// Картинки принадлежат Telegram и в архив проекта не входят: они сохраняются только на твоём ПК.
import { mkdir, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'gifts', 'nft')
const FLOORS = process.env.NFT_FLOORS_URL || 'https://raw.githubusercontent.com/Atlannn/telegram-gifts-floor-price/main/data/latest.json'
const FRAG = process.env.FRAGMENT_BASE || 'https://fragment.com'
const NFTCDN = process.env.NFT_CDN_BASE || 'https://nft.fragment.com'
const get = async (url, ms = 12000) => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms)
  try { return await fetch(url, { signal: c.signal }) } finally { clearTimeout(t) }
}

await mkdir(out, { recursive: true })
// красивые названия коллекций (Gift Club, CC BY 4.0) сохраняем рядом с иконками
try {
  const arr = await (await get('https://raw.githubusercontent.com/gift-club/telegram-gifts-dataset/main/data/gift-collections.json')).json()
  await writeFile(path.join(out, 'names.json'), JSON.stringify(Object.fromEntries(arr.map(c => [c.slug, c.name]))))
} catch { /* названия подгрузятся из сети */ }
let slugs = []
try {
  const fl = (await (await get(FLOORS)).json()).floors || {}
  slugs = Object.keys(fl)
  let nm = {}
  try { nm = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(out, 'names.json'), 'utf8')) } catch {}
}
catch { console.log('Иконки NFT: не удалось получить список коллекций, пропускаю.'); process.exit(0) }

const have = new Set((await readdir(out)).filter(f => f.endsWith('.webp')).map(f => f.slice(0, -5)))
const todo = slugs.filter(s => !have.has(s))
if (!todo.length) { await writeFile(path.join(out, 'index.json'), JSON.stringify([...have].sort())); console.log(`Иконки NFT: все ${have.size} уже сохранены.`); process.exit(0) }

console.log(`Иконки NFT: скачиваю ${todo.length} шт. (уже есть ${have.size})...`)
let done = 0, fail = 0, i = 0
const worker = async () => {
  while (i < todo.length) {
    const s = todo[i++]
    let ok = false
    for (const url of [`${FRAG}/file/gifts/${s}/thumb.webp`, `${NFTCDN}/gift/${s}-1.webp`]) {
      try {
        const r = await get(url)
        if (r.ok && /image/.test(r.headers.get('content-type') || 'image')) {
          const buf = Buffer.from(await r.arrayBuffer())
          if (buf.length > 200) { await writeFile(path.join(out, `${s}.webp`), buf); have.add(s); ok = true; break }
        }
      } catch { /* пробуем следующий адрес */ }
    }
    ok ? done++ : fail++
    if ((done + fail) % 20 === 0) console.log(`  ${done + fail}/${todo.length}`)
  }
}
await Promise.all(Array.from({ length: 6 }, worker))
await writeFile(path.join(out, 'index.json'), JSON.stringify([...have].sort()))
console.log(`Иконки NFT: сохранено ${done}, не удалось ${fail}${fail ? ' (для них останется запасная картинка, повторим при следующем запуске)' : ''}.`)
