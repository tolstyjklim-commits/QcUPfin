// Общие типы, ГСЧ и хранилище прогресса. Все «монеты» и «подарки» внутриигровые:
// их нельзя купить, вывести или обменять на реальные звёзды/подарки Telegram.

export const rnd = (): number => {
  const a = new Uint32Array(1)
  crypto.getRandomValues(a)
  return a[0] / 2 ** 32
}
export const rint = (n: number) => Math.floor(rnd() * n)
export const money = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n))
export const dateNow = () =>
  new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
export const todayKey = () => new Date().toISOString().slice(0, 10)

export function weighted<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rnd() * total
  for (let i = 0; i < items.length; i++) {
    r -= weights[i]
    if (r < 0) return items[i]
  }
  return items[items.length - 1]
}

export type GiftKind = string
export type GiftDef = {
  name: string; rarity: string; base: number; c1: string; c2: string
  shape: 'hex' | 'heart' | 'ball' | 'star' | 'diamond'
  thumb?: string      // картинка подарка из импорта (public/gifts/…)
  anim?: string       // анимированный стикер (.tgs)
  nft?: boolean       // коллекционный подарок: цена следует за реальным флором
  retired?: boolean   // старый подарок: остаётся у игрока, но не продаётся и не выпадает
}
// Живой реестр: заполняется из сохранения (setCatalog), читается везде как раньше.
export const GIFTS: Record<string, GiftDef> = {}
export const GIFT_ORDER: string[] = []           // только активные, от дешёвых к дорогим
export const CASE = { price: 50, weights: [] as number[], pool: [] as string[] } // веса параллельны pool (обычные подарки, без NFT)
export const FLAGS = { demo: false } // true, если загружены демо-данные из public/gifts
export const STARS_TO_COINS = 1 // 1 звезда = 1 монета: цена подарка в монетах совпадает с ценой в звёздах
export const COINS_PER_TON = 150 // 1 TON флора ≈ 150 монет (примерно 150 звёзд)

export function setCatalog(defs: Record<string, GiftDef>) {
  for (const k of Object.keys(GIFTS)) delete GIFTS[k]
  Object.assign(GIFTS, defs)
  GIFT_ORDER.length = 0
  GIFT_ORDER.push(...Object.keys(defs).filter(k => !defs[k].retired).sort((a, b) => defs[a].base - defs[b].base))
  // Кейсы: только обычные подарки; чем дороже подарок, тем реже он выпадает; цена задана так, что отдача ≈ 80% (игрок в среднем проигрывает)
  const pool = GIFT_ORDER.filter(k => !defs[k].nft)
  const n = pool.length
  const part = (from: number, to: number) => pool.slice(Math.floor(n * from), Math.max(Math.floor(n * from) + 1, Math.ceil(n * to)))
  // NFT-кейсы: коллекционные подарки с реальными флорами в заданном диапазоне цен, равномерно по возрастанию
  const nftAll = GIFT_ORDER.filter(k => defs[k].nft)
  const pickNft = (lo: number, hi: number, cap: number) => {
    const r = nftAll.filter(k => defs[k].base > lo && defs[k].base <= hi)
    if (r.length <= cap) return r
    return Array.from({ length: cap }, (_, i) => r[Math.round((i * (r.length - 1)) / (cap - 1))])
  }
  const specs: [string, string, string, string[], number][] = [
    ['basic', 'Новичок', '#7bd88f', part(0, 0.5), 1.4],
    ['mix', 'Классика', '#6aa8ff', pool, 1.4],
    ['gold', 'Золотой', '#ffc94d', part(0.4, 1), 1.7],
    ['elite', 'Элитный', '#c17bff', part(0.7, 1), 2.2],
    ['nft1', 'NFT · Старт', '#4fd8e8', pickNft(0, 1500, 14), 1.5],
    ['nft2', 'NFT · Редкие', '#ff7ab8', pickNft(1500, 9000, 14), 1.7],
  ]
  CASES.length = 0
  for (const [id, name, color, p, pw] of specs) {
    if (!p.length || CASES.some(c => c.pool.join() === p.join())) continue
    const w = p.map(k => 1 / Math.pow(defs[k].base, pw))
    const tw = w.reduce((a, b) => a + b, 0) || 1
    const ev = p.reduce((a, k, i) => a + (w[i] / tw) * defs[k].base, 0)
    CASES.push({ id, name, color, pool: p, weights: w, price: Math.max(10, Math.ceil(ev / CASE_RTP)), ev })
  }
  const c0 = CASES[0] || { pool: [], weights: [], price: 50 }
  CASE.pool = c0.pool; CASE.weights = c0.weights; CASE.price = c0.price
}
export const CASE_RTP = 0.8
export type CaseDef = { id: string; name: string; color: string; pool: string[]; weights: number[]; price: number; ev: number }
export const CASES: CaseDef[] = []
export const caseOddsOf = (c: CaseDef, i: number) => (c.weights[i] / (c.weights.reduce((a, b) => a + b, 0) || 1)) * 100
export const caseChance = (i: number) => {
  const tw = CASE.weights.reduce((a, b) => a + b, 0) || 1
  return (CASE.weights[i] / tw) * 100
}

// ---- импорт настоящих подарков Telegram (public/gifts/catalog.json) ----
export type ImportedGift = { id: string; name?: string; stars: number; emoji?: string; total?: number | null; remaining?: number | null; thumb?: string | null; anim?: string | null }
const hue = (id: string) => { let h = 2166136261; for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return (h >>> 7) % 360 }
const SHAPES: GiftDef['shape'][] = ['heart', 'star', 'diamond', 'hex', 'ball']
// Telegram не отдаёт названий обычных подарков (только эмодзи и цену): подписываем по эмодзи
const EMOJI_NAMES: Record<string, string> = { '💝': 'Сердце', '🧸': 'Мишка', '🎁': 'Подарок', '🌹': 'Роза', '🎂': 'Торт', '💐': 'Букет', '🚀': 'Ракета', '🍾': 'Шампанское', '🏆': 'Кубок', '💍': 'Кольцо', '💎': 'Алмаз' }
export function defsFromImport(list: ImportedGift[]): Record<string, GiftDef> {
  const out: Record<string, GiftDef> = {}
  for (const g of list) {
    if (!g.id || !(g.stars > 0)) continue
    const h = hue(g.id)
    const nm = g.name || EMOJI_NAMES[g.emoji || '']
    out[g.id] = {
      name: nm || `${g.emoji || '🎁'} ${g.stars}★`,
      rarity: `${g.total ? 'Лимитированный' : g.stars <= 25 ? 'Обычный' : g.stars <= 100 ? 'Редкий' : 'Эпический'}${nm ? ` · ${g.stars}★` : ''}`,
      base: Math.round(g.stars * STARS_TO_COINS),
      c1: `hsl(${h},85%,74%)`, c2: `hsl(${h},78%,54%)`,
      shape: SHAPES[h % SHAPES.length],
      thumb: g.thumb || undefined,
      anim: g.anim || undefined,
    }
  }
  return out
}
export const SELL_RATE = 0.95 // продажа на маркете: 95% от цены

export type Gift = { uid: string; kind: GiftKind; num: number }
export type Tx = { id: string; title: string; amount: number; date: string }
export type Save = {
  v: 3
  catalog: Record<string, GiftDef>
  balance: number
  gifts: Gift[]
  nextNum: number
  starter?: boolean // стартовые подарки уже выданы
  tx: Tx[]
  prices: Record<GiftKind, number>
  priceOpen: { date: string; prices: Record<GiftKind, number> }
  daily: { last: string; streak: number }
  tasks: Record<string, boolean>
  stats: Record<string, number>
  xp?: number                      // опыт для уровней
  ach?: Record<string, boolean>    // полученные достижения
}

// Демо-версия (сборка с VITE_DEMO=1): отдельное хранилище, стартовый баланс, никаких платежей. Реальная игра этого не касается.
export const DEMO = (import.meta as any).env?.VITE_DEMO === '1'
const KEY = DEMO ? 'qcup-demo-save' : 'qcup-save-v2'
const basePrices = (defs: Record<string, GiftDef>): Record<GiftKind, number> =>
  Object.fromEntries(Object.keys(defs).map(k => [k, defs[k].base]))

export const uid = () => crypto.randomUUID()

export function defaultSave(): Save {
  const prices: Record<GiftKind, number> = {}
  return {
    v: 3,
    catalog: {},
    balance: DEMO ? 100000 : 0, // в реальной игре стартовых монет нет: баланс появляется только после пополнения
    gifts: [],
    starter: false,
    nextNum: 5000,
    tx: [],
    prices,
    priceOpen: { date: todayKey(), prices: { ...prices } },
    daily: { last: '', streak: 0 },
    tasks: {},
    stats: {},
    xp: 0,
    ach: {},
  }
}

export function loadSave(): Save {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as Save
      if ((s.v as number) === 2) { s.v = 3; s.catalog = {} } // миграция старого сохранения
      if (s.v === 3) {
        s.xp = s.xp || 0; s.ach = s.ach || {}
        if (s.priceOpen.date !== todayKey()) s.priceOpen = { date: todayKey(), prices: { ...s.prices } }
        return s
      }
    }
  } catch { /* повреждённые данные — начинаем заново */ }
  return defaultSave()
}
export const persist = (s: Save) => {
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* переполнено/запрещено */ }
}

// Небольшое случайное блуждание цен вокруг базовой (коридор 70–140%).
export function walkPrices(p: Record<GiftKind, number>): Record<GiftKind, number> {
  const out = { ...p }
  for (const k of Object.keys(out)) {
    if (!GIFTS[k] || GIFTS[k].retired || GIFTS[k].nft) continue
    const b = GIFTS[k].base
    const next = out[k] * (1 + (rnd() - 0.5) * 0.06)
    out[k] = Math.round(Math.min(b * 1.4, Math.max(b * 0.7, next)))
  }
  return out
}

// ---- Платёжная математика (RTP указан в комментариях) ----
// Краш: точка вылета с «налогом» 3% (RTP 97%)
export const crashPoint = () => {
  const r = rnd()
  return Math.min(1000, Math.max(1, Math.floor(97 / (1 - r)) / 100))
}
export const SYMBOLS = ['💎', '7⭐', '🍀', '🔔', '🍇', '🍋', '⭐', '💰']
export const SYMBOL_WEIGHTS = [1, 1, 3, 4, 6, 8, 12, 20]
const BASE_PAY = [25, 15, 8, 5, 3, 2, 2, 1.5]
export const pickSymbol = () => weighted(SYMBOLS, SYMBOL_WEIGHTS)
// 5×3, 9 линий, ставка делится на линии: RTP ≈ 93%
export const STORM_PAY = (sym: string, run: number) => {
  const i = SYMBOLS.indexOf(sym)
  const mul = run === 3 ? 1 : run === 4 ? 3 : 10
  return 3.8 * BASE_PAY[i] * mul
}
// 3 барабана: три одинаковых, RTP ≈ 96%
export const SLOT3_PAY = (sym: string) => 9 * BASE_PAY[SYMBOLS.indexOf(sym)]
export const PAYLINES: number[][] = [
  [0, 0, 0, 0, 0], [1, 1, 1, 1, 1], [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1], [1, 2, 2, 2, 1],
]
// Plinko, 8 рядов: RTP ≈ 96%
export const PLINKO_RISK = {
  low: [5, 2, 1.1, 0.9, 0.5, 0.9, 1.1, 2, 5],      // RTP ≈ 93,5%
  mid: [9, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 9],      // RTP ≈ 95,8%
  high: [26, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 26],   // RTP ≈ 96,7%
} as const
export type PlinkoRisk = keyof typeof PLINKO_RISK
export const PLINKO_MULTS: readonly number[] = PLINKO_RISK.mid
// Мины 4×4, 3 мины: коэффициент после k безопасных клеток, RTP 97%
export const MINES_TOTAL = 16
export const MINES_COUNT = 3
export const minesMult = (k: number, bombs = MINES_COUNT) => {
  let m = 0.97
  for (let i = 0; i < k; i++) m *= (MINES_TOTAL - i) / (MINES_TOTAL - bombs - i)
  return m
}
export const UPGRADE_RTP = 0.94
export const upgradeChance = (cur: number, target: number) => Math.min(0.9, (UPGRADE_RTP * cur) / target)

// Подмешивает импортированный каталог: новые подарки активны, остальные уходят в «архив».
export function mergeCatalog(save: Save, imported: Record<string, GiftDef>): Save {
  const ids = Object.keys(imported)
  if (!ids.length) return save
  const catalog: Record<string, GiftDef> = {}
  const hasReal = ids.some(k => !imported[k].nft)
  const held = new Set(hasReal ? [] : save.gifts.map(g => g.kind).filter(k => !imported[k]))
  for (const k of Object.keys(save.catalog)) if (save.catalog[k].nft || held.has(k)) catalog[k] = save.catalog[k].nft ? save.catalog[k] : { ...save.catalog[k], retired: true } // NFT не трогаем: они грузятся отдельно; ненужные старые убираем
  Object.assign(catalog, imported)
  const prices = { ...save.prices }, open = { ...save.priceOpen.prices }
  for (const k of ids) { prices[k] = imported[k].base; open[k] = prices[k] } // при каждом импорте цены сбрасываются на актуальные
  // подарки, которых нет в настоящем каталоге (старые выдуманные), заменяем на настоящие самой близкой цены
  const real = ids.filter(k => !imported[k].nft).sort((a, b) => imported[a].base - imported[b].base)
  let gifts = save.gifts
  if (real.length) {
    gifts = gifts.map(g => {
      if (imported[g.kind] || save.catalog[g.kind]?.nft) return g
      const old = save.catalog[g.kind]?.base ?? 100
      const best = real.reduce((a, k) => (Math.abs(imported[k].base - old) < Math.abs(imported[a].base - old) ? k : a), real[0])
      return { ...g, kind: best }
    })
    // два стартовых подарка выдаём один раз
  }
  return { ...save, gifts, starter: save.starter || real.length > 0, catalog, prices, priceOpen: { ...save.priceOpen, prices: open } }
}

// ---- NFT-подарки (коллекции) с флор-ценами в TON ----
export type NftCollection = { id: string; name: string; floorTon: number; image?: string | null }
export function defsFromNft(list: NftCollection[]): Record<string, GiftDef> {
  const out: Record<string, GiftDef> = {}
  for (const c of list) {
    if (!c.id || !(c.floorTon > 0)) continue
    const key = `nft:${c.id}`, h = hue(key)
    out[key] = {
      name: c.name, rarity: 'Коллекционный', base: Math.max(1, Math.round(c.floorTon * COINS_PER_TON)),
      c1: `hsl(${h},85%,74%)`, c2: `hsl(${h},78%,54%)`, shape: 'diamond', thumb: c.image || undefined, nft: true,
    }
  }
  return out
}
// Цена NFT в игре равна текущему флору (без случайного блуждания).
export function mergeNft(save: Save, defs: Record<string, GiftDef>): Save {
  const ids = Object.keys(defs)
  if (!ids.length) return save
  const prices = { ...save.prices }, open = { ...save.priceOpen.prices }
  for (const k of ids) { prices[k] = defs[k].base; if (!open[k]) open[k] = defs[k].base }
  // выдуманные/устаревшие NFT, которых нет в настоящем списке, убираем; те, что лежат у игрока, меняем на настоящую коллекцию близкой цены
  const catalog = { ...save.catalog }
  for (const k of Object.keys(catalog)) if (catalog[k].nft && !defs[k]) delete catalog[k]
  const gifts = save.gifts.map(g => {
    if (defs[g.kind] || catalog[g.kind]) return g
    const old = save.catalog[g.kind]
    if (!old?.nft) return g
    const best = ids.reduce((a, k) => (Math.abs(defs[k].base - old.base) < Math.abs(defs[a].base - old.base) ? k : a), ids[0])
    return { ...g, kind: best }
  })
  return { ...save, gifts, catalog: { ...catalog, ...defs }, prices, priceOpen: { ...save.priceOpen, prices: open } }
}

// ---- «Дом всегда в плюсе» ----
// Игры ведут учёт: сколько игрок поставил и сколько получил. Небольшой плюс (300 монет + 15% от ставок) допускается,
// при большем плюсе шансы в играх понемногу ухудшаются (до 30%). Об этом честно сказано в игре и в README.
export const GAME_TITLE = /^(Ракета|Шторм|Слоты|Мины|Plinko|Блэкджек|Особняк|Орёл и решка|Кейс)/
export const houseTilt = (stats: Record<string, number>) => {
  const staked = stats.gStaked || 0, paid = stats.gPaid || 0
  const excess = paid - staked - (300 + 0.15 * staked)
  return excess > 0 ? Math.min(0.3, excess / (3000 + excess)) : 0
}
