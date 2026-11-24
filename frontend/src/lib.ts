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
// Прогресс хранится отдельно для каждого аккаунта Telegram: на одном устройстве разные люди не делят баланс.
const TGID = (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.id
const LEGACY_KEY = 'qcup-save-v2'
export const SAVE_KEY = DEMO ? 'qcup-demo-save' : TGID ? `qcup-save-v2-${TGID}` : LEGACY_KEY
const KEY = SAVE_KEY
if (!DEMO && TGID) { try { // однократный перенос старого общего сохранения первому вошедшему аккаунту
  if (!localStorage.getItem(KEY) && localStorage.getItem(LEGACY_KEY)) { localStorage.setItem(KEY, localStorage.getItem(LEGACY_KEY)!); localStorage.removeItem(LEGACY_KEY) }
} catch { /* хранилище недоступно */ } }
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
// 5×3, 9 линий, ставка делится на линии: RTP ≈ 87% (проверено симуляцией на миллионах спинов).
// Крупные символы платят умеренно: самая большая линия (5 бриллиантов) даёт около ×37 от ставки.
const STORM_BASE = [14, 9, 6, 4.5, 3.4, 2.6, 2.3, 2]
export const STORM_PAY = (sym: string, run: number) => {
  const i = SYMBOLS.indexOf(sym)
  const mul = run === 3 ? 1 : run === 4 ? 3 : 8
  return Math.round(3 * STORM_BASE[i] * mul * 2) / 2
}
// 3 барабана: три одинаковых, RTP ≈ 87%
const SLOT3_TABLE = [90, 55, 32, 22, 16, 12, 17, 13]
export const SLOT3_PAY = (sym: string) => SLOT3_TABLE[SYMBOLS.indexOf(sym)]
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

// ---- Гонки ----
// Настоящая симуляция заезда на овале в 3 круга. У каждой машины свои характеристики: скорость на прямых, поворот, разгон
// и надёжность. На прямой машина сзади получает слипстрим, один раз за гонку включается нитро, в поворотах бывают ошибки.
// Исход разыгрывается этим же движком (без поправок под игрока), а шансы и коэффициенты посчитаны прогоном того же движка
// на миллионе заездов (RACE_PROBS). Если поменять характеристики или параметры движка, пересчитай их: raceEstimate(n).
export const RACE_RTP = 0.95
export const RACE_LAPS = 3
const CORNER = Math.PI * 70
const SECT = [{ len: 70, c: false }, { len: CORNER, c: true }, { len: 140, c: false }, { len: CORNER, c: true }, { len: 70, c: false }]
export const LAP_LEN = 70 + CORNER + 140 + CORNER + 70
export const RACE_LEN = LAP_LEN * RACE_LAPS
export type RaceCar = { id: string; name: string; color: string; color2: string; speed: number; corner: number; accel: number; rely: number; note: string }
export const RACERS: RaceCar[] = [
  { id: 'v', name: 'Вихрь', color: '#ff5d73', color2: '#b8213a', speed: 9, corner: 8, accel: 8, rely: 8, note: 'Универсал: быстрый и ровный' },
  { id: 'k', name: 'Комета', color: '#4cc9f0', color2: '#1a78a8', speed: 10, corner: 8, accel: 7, rely: 6, note: 'Летит на прямых, теряет в поворотах' },
  { id: 'g', name: 'Гром', color: '#ffc24b', color2: '#c27d0a', speed: 6, corner: 9, accel: 8, rely: 8, note: 'Король поворотов, медленнее на прямых' },
  { id: 'l', name: 'Лайм', color: '#7bd88f', color2: '#2f8f4a', speed: 8, corner: 8, accel: 7, rely: 10, note: 'Надёжный: почти не ошибается' },
  { id: 'f', name: 'Фиалка', color: '#c17bff', color2: '#7430bd', speed: 9, corner: 7, accel: 10, rely: 6, note: 'Мощный разгон, но рискует' },
  { id: 't', name: 'Тень', color: '#9aa7b0', color2: '#4a565e', speed: 8, corner: 8, accel: 6, rely: 5, note: 'Аутсайдер: часто ошибается, но может выстрелить' },
]
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r())
export type RaceEvent = { t: number; car: number; kind: 'nitro' | 'mistake' | 'lead' | 'finish' | 'lap'; place?: number; lap?: number }
export type RaceSim = { dt: number; frames: number[][]; fin: number[]; order: number[]; events: RaceEvent[]; duration: number }
// параметры движка
const FORM_SIGMA = 0.02        // «форма дня» машины на весь заезд
const SECT_SIGMA = 0.014       // шум скорости на каждом участке; растёт у ненадёжных
const MISTAKE_BASE = 0.01      // шанс ошибки на входе в поворот: база + (10 - надёжность) * шаг
const MISTAKE_STEP = 0.012
export function raceSimulate(rand: () => number = rnd): RaceSim {
  const n = RACERS.length, dt = 0.05
  const grid = RACERS.map((_, i) => i)
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [grid[i], grid[j]] = [grid[j], grid[i]] } // стартовая решётка случайная
  const d = RACERS.map((_, i) => -grid.indexOf(i) * 4), v = RACERS.map(() => 0), fin = RACERS.map(() => -1)
  const form = RACERS.map(() => 1 + gauss(rand) * FORM_SIGMA)
  const nitroAt = RACERS.map(() => LAP_LEN * (1 + rand() * 1.6))
  const nitroLeft = RACERS.map(() => 0), nitroUsed = RACERS.map(() => false), mistakeLeft = RACERS.map(() => 0)
  const secKey = RACERS.map(() => -1), noise = RACERS.map(() => 1)
  const frames: number[][] = [d.slice()], events: RaceEvent[] = []
  let leader = -1, lapShown = 1, t = 0, placed = 0
  while (fin.some(f => f < 0) && t < 240) {
    t += dt
    const snap = d.slice()
    for (let i = 0; i < n; i++) {
      if (fin[i] >= 0) continue
      const c = RACERS[i]
      const lp = d[i] <= 0 ? 0 : d[i] % LAP_LEN
      let k = 0, acc = 0
      while (k < SECT.length - 1 && lp >= acc + SECT[k].len) { acc += SECT[k].len; k++ }
      const key = Math.floor(Math.max(0, d[i]) / LAP_LEN) * SECT.length + k
      if (key !== secKey[i]) {
        secKey[i] = key
        noise[i] = 1 + gauss(rand) * (SECT_SIGMA + (10 - c.rely) * 0.002)
        if (SECT[k].c && d[i] > 0 && rand() < MISTAKE_BASE + (10 - c.rely) * MISTAKE_STEP) { mistakeLeft[i] = 0.9; events.push({ t, car: i, kind: 'mistake' }) }
      }
      if (!nitroUsed[i] && d[i] >= nitroAt[i]) { nitroUsed[i] = true; nitroLeft[i] = 2; events.push({ t, car: i, kind: 'nitro' }) }
      let tgt = (SECT[k].c ? 52 + 1.6 * c.corner : 84 + 2 * c.speed) * form[i] * noise[i]
      if (!SECT[k].c && snap.some((x, j) => j !== i && fin[j] < 0 && x > snap[i] && x - snap[i] < 14)) tgt *= 1.04 // слипстрим
      if (nitroLeft[i] > 0) { tgt *= c.id === 'f' ? 1.14 : 1.1; nitroLeft[i] -= dt }
      if (mistakeLeft[i] > 0) { tgt *= 0.6; mistakeLeft[i] -= dt }
      const a = 22 + 1.2 * c.accel
      v[i] = v[i] < tgt ? Math.min(tgt, v[i] + a * dt) : Math.max(tgt, v[i] - 45 * dt)
      d[i] += v[i] * dt
      if (d[i] >= RACE_LEN) { fin[i] = t - (d[i] - RACE_LEN) / v[i]; d[i] = RACE_LEN; v[i] = 0; events.push({ t: fin[i], car: i, kind: 'finish', place: ++placed }) }
    }
    let ld = 0
    for (let i = 1; i < n; i++) if (d[i] > d[ld]) ld = i
    if (leader !== ld && t > 2) { if (leader >= 0 && d[ld] < RACE_LEN) events.push({ t, car: ld, kind: 'lead' }); leader = ld } else if (leader < 0) leader = ld
    const lap = Math.min(RACE_LAPS, Math.floor(Math.max(0, d[ld]) / LAP_LEN) + 1)
    if (lap > lapShown) { lapShown = lap; events.push({ t, car: ld, kind: 'lap', lap }) }
    frames.push(d.slice())
  }
  const order = RACERS.map((_, i) => i).sort((a, b) => (fin[a] < 0 ? 1e9 : fin[a]) - (fin[b] < 0 ? 1e9 : fin[b]))
  return { dt, frames, fin, order, events, duration: Math.max(...fin) }
}
// Оценка шансов прогоном движка (для пересчёта RACE_PROBS после смены параметров).
export const raceEstimate = (runs: number, rand: () => number = rnd) => {
  const win = RACERS.map(() => 0), top3 = RACERS.map(() => 0)
  for (let r = 0; r < runs; r++) { const { order } = raceSimulate(rand); win[order[0]]++; for (let k = 0; k < 3; k++) top3[order[k]]++ }
  return { win: win.map(x => x / runs), top3: top3.map(x => x / runs) }
}
export const RACE_PROBS = { win: [0.2211, 0.2566, 0.1982, 0.1144, 0.1238, 0.0859], top3: [0.6031, 0.6238, 0.5776, 0.4253, 0.4379, 0.3323] } // 800 000 заездов движка
// Коэффициент округляется вниз до сотых: округление всегда в пользу казино, а не игрока.
export const raceOdds = (p: number) => Math.max(1.01, Math.floor((RACE_RTP / p) * 100) / 100)
