import { sfx, play } from './sfx'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, ChevronLeft, Gamepad2, Gift, ListChecks, Package, Plus, UserRound, Volume2, VolumeX, X } from 'lucide-react'
import { Coin, GiftArt, TonIcon, UsdtIcon } from './art'
import { ACHIEVEMENTS, DAILY_XP, TASK_XP, betXp, levelInfo, rankOf } from './levels'
import { DEMO } from './lib'
import { DepositModal, liveRates, ownerDemoUnlocked, useLocalDeposits } from './deposit'
import {

  Blackjack, Cases, Coinflip, Crash, Mansion, Mines, Plinko, Slots, Storm, Upgrade, type Ctx,
} from './games'
import {
  CASE, CASES, GAME_TITLE, caseOddsOf, FLAGS, houseTilt, GIFTS, GIFT_ORDER, COINS_PER_TON, SELL_RATE, STARS_TO_COINS, dateNow, defaultSave, defsFromImport, defsFromNft, loadSave, mergeCatalog, mergeNft, money, persist, setCatalog, todayKey, uid, walkPrices,
  type ImportedGift, type NftCollection,
  type Gift as GiftT, type GiftKind, type Save, type Tx,
} from './lib'

type Tab = 'Игры' | 'Кейсы' | 'Подарки' | 'Задания' | 'Профиль'
type GameId = 'upgrade' | 'storm' | 'rocket' | 'slots' | 'cases' | 'mansion' | 'coin' | 'mines' | 'blackjack' | 'plinko' | 'racing' | 'launch'
type GameDef = { id: GameId; name: string; image: string; players: string; tag?: string; desc: string; soon?: boolean }

const tabs: { label: Tab; icon: typeof Gamepad2 }[] = [
  { label: 'Игры', icon: Gamepad2 }, { label: 'Кейсы', icon: Package }, { label: 'Подарки', icon: Gift },
  { label: 'Задания', icon: ListChecks }, { label: 'Профиль', icon: UserRound },
]
const games: GameDef[] = [
  { id: 'upgrade', name: 'Апгрейд', image: 'upgrade', players: '1 240', tag: 'HOT', desc: 'Обменяй подарок на более редкий' },
  { id: 'storm', name: 'Шторм', image: 'storm', players: '3 410', tag: 'X500', desc: 'Слот 5×3, девять линий' },
  { id: 'rocket', name: 'Ракета', image: 'rocket', players: '2 080', tag: 'LIVE', desc: 'Забери множитель до вылета' },
  { id: 'cases', name: 'Кейсы', image: 'cases', players: '117', tag: 'NEW', desc: 'Открой кейс, получи подарок' },
  { id: 'slots', name: 'Быстрые слоты', image: 'cases', players: '284', desc: 'Три барабана, один спин' },
  { id: 'mines', name: 'Мины', image: 'mines', players: '29', desc: 'Открывай клетки, избегай мин' },
  { id: 'plinko', name: 'Plinko', image: 'storm', players: '15', desc: 'Шар падает на множитель' },
  { id: 'blackjack', name: 'Блэкджек', image: 'cases', players: '10', desc: 'Набери 21 очко' },
  { id: 'mansion', name: 'Особняк', image: 'mansion', players: '27', desc: 'Найди награду за дверью' },
  { id: 'coin', name: 'Орёл и решка', image: 'upgrade', players: '58', tag: 'NEW', desc: 'Серия побед и множитель ×1,9' },
  { id: 'racing', name: 'Гонки', image: 'racing', players: '42', desc: 'Скоро', soon: true },
  { id: 'launch', name: 'Запуск', image: 'launch', players: '63', desc: 'Скоро', soon: true },
]
const TITLES: Record<string, string> = Object.fromEntries(games.map(g => [g.id, g.name]))

const DAILY = [1, 2, 3, 4, 5, 6, 7] // дни серии входов; монет за вход не дают
const TASKS: { id: string; title: string; hint: () => string; stat: string; target: number }[] = [
  { id: 'crash3', title: '3 раунда в Ракете', hint: () => 'Любая ставка', stat: 'crash', target: 3 },
  { id: 'rounds10', title: '10 раундов в играх', hint: () => 'Любые игры', stat: 'rounds', target: 10 },
  { id: 'case1', title: 'Открыть кейс', hint: () => `Стоит ${CASE.price}`, stat: 'cases', target: 1 },
  { id: 'upg1', title: 'Сделать апгрейд', hint: () => 'Успешный или нет', stat: 'upgrades', target: 1 },
  { id: 'trade1', title: 'Купить или продать подарок', hint: () => 'На маркете', stat: 'trades', target: 1 },
]

export default function App() {
  const [save, setSave] = useState<Save>(() => { const s = loadSave(); setCatalog(s.catalog); return s })
  const S = useRef(save)
  const [tab, setTab] = useState<Tab>('Игры')
  const [game, setGame] = useState<GameId | null>(null)
  const [seed, setSeed] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [sound, setSound] = useState(() => localStorage.getItem('qcup-sound') === '1')
  const [confetti, setConfetti] = useState(0)
  const [depositOpen, setDepositOpen] = useState(false)
  const [demoOk, setDemoOk] = useState(false) // демо-режим владельца (адрес игры + #demo)
  useEffect(() => { ownerDemoUnlocked().then(setDemoOk) }, [])
  // если сохранение изменили в другой вкладке (например, demo.html), подхватываем без перезагрузки
  useEffect(() => {
    const h = (e: StorageEvent) => { if (e.key === 'qcup-save-v2') { const s = loadSave(); S.current = s; setSave(s) } }
    window.addEventListener('storage', h)
    return () => window.removeEventListener('storage', h)
  }, [])
  // Валюта отображения баланса: звёзды игры, TON или USDT (пересчёт по рыночному курсу; ставки в играх всегда в звёздах)
  const [cur, setCur] = useState<'STAR' | 'TON' | 'USDT'>(() => { try { const v = localStorage.getItem('qcup-cur'); return v === 'TON' || v === 'USDT' ? v : 'STAR' } catch { return 'STAR' } })
  const [curMenu, setCurMenu] = useState(false)
  const [rates, setRates] = useState<{ ton: number; usdt: number } | null>(null)
  useEffect(() => {
    const load = () => liveRates().then(r => setRates({ ton: r.ton, usdt: r.usdt }))
    load()
    const t = window.setInterval(load, 60_000) // курс обновляется постоянно
    return () => clearInterval(t)
  }, [])
  const pickCur = (c: 'STAR' | 'TON' | 'USDT') => { setCur(c); setCurMenu(false); try { localStorage.setItem('qcup-cur', c) } catch { /* хранилище недоступно */ } }
  const fmtBal = (stars: number) => cur === 'TON' && rates ? `${(stars / rates.ton).toFixed(3)} TON` : cur === 'USDT' && rates ? `${(stars / rates.usdt).toFixed(2)} USDT` : money(stars)

  const commit = useCallback((f: (s: Save) => Save) => {
    const next = f(S.current)
    if (next.catalog !== S.current.catalog) setCatalog(next.catalog)
    S.current = next
    setSave(next)
    persist(next)
  }, [])

  // Подарки Telegram: сначала автовыгрузка с бэкенда (бот подключён), иначе public/gifts/catalog.json
  useEffect(() => {
    const raw = (import.meta as any).env?.VITE_API_URL as string | undefined
    const API = raw === 'same' ? '' : raw?.replace(/\/$/, '') // 'same' = тот же домен (dev-прокси на бэкенд)
    type Cat = { gifts?: ImportedGift[]; updated?: string; demo?: boolean }
    const apply = (j: Cat, base: string, live: boolean) => {
      if (!j.gifts?.length) return false
      if (j.demo) FLAGS.demo = true
      else if (live) FLAGS.demo = false
      const defs = defsFromImport(j.gifts.map(g => ({ ...g, thumb: g.thumb ? base + g.thumb : null, anim: g.anim ? base + g.anim : null })))
      const ids = Object.keys(defs)
      if (!ids.length) return false
      const sig = `ids:${ids.join(',')}:k${STARS_TO_COINS}:v5` // одинаковый набор подарков из любого источника не применяется дважды
      if (localStorage.getItem('qcup-catalog-sig') === sig && S.current.catalog[ids[0]]) return true
      localStorage.setItem('qcup-catalog-sig', sig)
      for (const d of Object.values(defs)) if (d.thumb) { const im = new Image(); im.src = d.thumb } // прогреваем иконки
      commit(s => mergeCatalog(s, defs))
      setNotice(FLAGS.demo ? `Загружены демо-подарки: ${ids.length}` : `Подарки Telegram загружены: ${ids.length}`)
      return true
    }
    let dead = false, timer = 0
    const run = async () => {
      let live = false
      if (API !== undefined) {
        try {
          const r = await fetch(`${API}/api/gifts/catalog`, { cache: 'no-cache' })
          if (r.ok && apply((await r.json()) as Cat, API, true)) live = true
        } catch { /* бэкенд недоступен — берём статичный каталог */ }
      }
      if (!live) {
        try {
          const r = await fetch('./gifts/catalog.json', { cache: 'no-cache' })
          if (r.ok) apply((await r.json()) as Cat, './gifts/', false)
        } catch { /* каталога нет — работаем со встроенным набором */ }
      }
      // бэкенд мог ещё не успеть выгрузить подарки: повторяем, пока не получим живой каталог
      if (!dead && API !== undefined) timer = window.setTimeout(run, live ? 10 * 60_000 : 8_000)
    }
    run()
    return () => { dead = true; clearTimeout(timer) }
  }, [commit])

  // Автоподгрузка NFT-подарков с флор-ценами: бэкенд (/api/nft/floors) или статичный public/gifts/nft.json
  useEffect(() => {
    let dead = false
    const raw = (import.meta as any).env?.VITE_API_URL as string | undefined
    const API = raw === 'same' ? '' : raw?.replace(/\/$/, '')
    const load = async () => {
      // бэкенд -> открытый датасет флор-цен Fragment (напрямую, без ключей) -> демо public/gifts/nft.json
      const NAMES = 'https://raw.githubusercontent.com/gift-club/telegram-gifts-dataset/main/data/gift-collections.json'
      const OPEN = 'https://raw.githubusercontent.com/Atlannn/telegram-gifts-floor-price/main/data/latest.json'
      const sources = ['./gifts/nft.json', API !== undefined ? `${API}/api/nft/floors` : '', OPEN].filter(Boolean) // сначала локальный файл с ценами (мгновенно), потом свежие данные из сети
      for (const url of sources) {
        try {
          const r = await fetch(url, { cache: 'no-cache' })
          if (!r.ok) continue
          let j = (await r.json()) as { collections?: NftCollection[]; demo?: boolean; floors?: Record<string, number> }
          if (j.floors) {
            const names: Record<string, string> = {}
            try { for (const c of (await (await fetch(NAMES)).json()) as { slug: string; name: string }[]) names[c.slug] = c.name } catch { /* без красивых названий */ }
            j = { collections: Object.entries(j.floors).filter(([, v]) => v > 0).map(([id, floorTon]) => ({ id, name: names[id] || id.charAt(0).toUpperCase() + id.slice(1), floorTon, image: `https://fragment.com/file/gifts/${id}/thumb.webp` })) }
          }
          if (j.demo) FLAGS.demo = true
          const cols = (j.collections || []).map(c => (j.demo ? { ...c, floorTon: c.floorTon * (1 + (Math.random() - 0.5) * 0.08) } : c))
          // иконки и названия берём с этого компьютера (их сохраняет лаунчер), чтобы не зависеть от бэкенда и сети
          const [idx, nm] = await Promise.all([
            fetch('./gifts/nft/index.json').then(r => (r.ok ? r.json() : [])).catch(() => []) as Promise<string[]>,
            fetch('./gifts/nft/names.json').then(r => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<Record<string, string>>,
          ])
          const have = new Set(idx)
          for (const c of cols) {
            if (j.demo) break
            if (nm[c.id]) c.name = nm[c.id]
            if (have.has(c.id)) c.image = `./gifts/nft/${c.id}.webp`
            else if (!c.image) c.image = `https://fragment.com/file/gifts/${c.id}/thumb.webp`
          }
          const defs = defsFromNft(cols)
          if (dead || !Object.keys(defs).length) continue
          commit(s => mergeNft(s, defs))
          if (url !== './gifts/nft.json') return
        } catch { /* пробуем следующий источник */ }
      }
    }
    load()
    const t = window.setInterval(load, FLAGS.demo ? 30_000 : 5 * 60_000)
    return () => { dead = true; clearInterval(t) }
  }, [commit])

  const user = (window as any).Telegram?.WebApp?.initDataUnsafe?.user
  const displayName: string = user?.first_name || 'Игрок'

  // Пополнения без бэкенда (GitHub Pages): сайт сам находит платёж в блокчейне и добавляет монеты
  useLocalDeposits(useCallback((coins: number, asset: string) => {
    commit(s => ({ ...s, balance: s.balance + coins, tx: [{ id: uid(), title: `Пополнение ${asset}`, amount: coins, date: dateNow() }, ...s.tx].slice(0, 60) }))
    setNotice(`Пополнение: +${money(coins)} ⭐`)
  }, [commit]))

  // Пополнения: зачисленные на сервере монеты один раз попадают в баланс игр
  useEffect(() => {
    const raw = (import.meta as any).env?.VITE_API_URL as string | undefined
    const API = raw === 'same' ? '' : raw?.replace(/\/$/, '')
    const initData = (window as any).Telegram?.WebApp?.initData
    if (API === undefined || !initData) return
    const h = { 'content-type': 'application/json', 'x-telegram-init-data': initData }
    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const r = await fetch(`${API}/api/deposit/unclaimed`, { headers: h })
        if (!r.ok) return
        const rows = (await r.json()) as { id: string }[]
        if (!rows.length) return
        const c = await fetch(`${API}/api/deposit/claim`, { method: 'POST', headers: h, body: JSON.stringify({ ids: rows.map(x => x.id) }) })
        if (!c.ok) return
        const coins = Number((await c.json()).coins)
        if (coins > 0) {
          commit(s => ({ ...s, balance: s.balance + coins, tx: [{ id: uid(), title: 'Пополнение', amount: coins, date: dateNow() }, ...s.tx].slice(0, 60) }))
          setNotice(`Пополнение: +${money(coins)} ⭐`)
        }
      } catch { /* повторим на следующем тике */ } finally { busy = false }
    }
    tick()
    const t = window.setInterval(tick, 6000)
    return () => clearInterval(t)
  }, [commit])

  useEffect(() => { localStorage.setItem('qcup-sound', sound ? '1' : '0'); sfx.enabled = sound }, [sound])
  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(''), 3200)
    return () => clearTimeout(t)
  }, [notice])
  // Цены на маркете плавно меняются раз в 20 секунд
  useEffect(() => {
    const t = window.setInterval(() => commit(s => ({ ...s, prices: walkPrices(s.prices) })), 20000)
    return () => clearInterval(t)
  }, [commit])

  const beep = useCallback((f: number, _ms?: number) => { if (f < 300) play.lose(); else if (f > 800) play.coin(); else play.click() }, [])

  const ctx: Ctx = useMemo(() => {
    const tx = (title: string, amount: number): Tx => ({ id: uid(), title, amount, date: dateNow() })
    return {
      save,
      notify: setNotice,
      charge: (cost, title, countRound = true) => {
        if (!(cost > 0) || !Number.isFinite(cost)) return false
        if (S.current.balance < cost) { setNotice('Не хватает звёзд'); beep(150, 200); return false }
        commit(s => ({
          ...s, balance: s.balance - cost, xp: (s.xp || 0) + (countRound ? betXp(cost) : 0),
          tx: [tx(title, -cost), ...s.tx].slice(0, 60),
          stats: { ...s.stats, rounds: (s.stats.rounds || 0) + (countRound ? 1 : 0), gStaked: (s.stats.gStaked || 0) + (GAME_TITLE.test(title) ? cost : 0) },
        }))
        beep(380, 80)
        return true
      },
      pay: (amount, title) => {
        if (!(amount > 0)) return
        commit(s => ({ ...s, balance: s.balance + amount, tx: [tx(title, amount), ...s.tx].slice(0, 60), stats: { ...s.stats, gPaid: (s.stats.gPaid || 0) + (GAME_TITLE.test(title) ? amount : 0) } }))
        setConfetti(c => c + 1); setNotice(`${title}: +${money(amount)}`); beep(880, 220)
      },
      addGift: (kind, title) => {
        const gift: GiftT = { uid: uid(), kind, num: S.current.nextNum }
        commit(s => ({ ...s, gifts: [...s.gifts, gift], nextNum: s.nextNum + 1 + Math.floor(Math.random() * 40), tx: [tx(`${title}: ${GIFTS[kind]?.name}`, 0), ...s.tx].slice(0, 60) }))
        setConfetti(c => c + 1); beep(988, 260)
        return gift
      },
      removeGift: id => commit(s => ({ ...s, gifts: s.gifts.filter(g => g.uid !== id) })),
      tally: (staked, paid) => commit(s => ({ ...s, stats: { ...s.stats, gStaked: (s.stats.gStaked || 0) + staked, gPaid: (s.stats.gPaid || 0) + paid } })),
      tilt: () => houseTilt(S.current.stats),
      bump: key => commit(s => ({ ...s, stats: { ...s.stats, [key]: (s.stats[key] || 0) + 1 } })),
    }
  }, [save, commit, beep])

  const openGame = (id: GameId, seedUid: string | null = null) => { setSeed(seedUid); setGame(id) }
  const dailyReady = save.daily.last !== todayKey()

  // ---- маркет ----
  const buy = (k: GiftKind) => {
    const price = S.current.prices[k]
    if (S.current.balance < price) return setNotice('Не хватает звёзд')
    ctx.charge(price, `Покупка: ${GIFTS[k]?.name}`, false)
    ctx.bump('trades')
    const g = ctx.addGift(k, 'Покупка')
    setNotice(`Куплено: ${GIFTS[k]?.name} #${g.num}`)
  }
  const sell = (g: GiftT) => {
    const price = Math.floor(S.current.prices[g.kind] * SELL_RATE)
    ctx.removeGift(g.uid)
    ctx.bump('trades')
    ctx.pay(price, `Продажа: ${GIFTS[g.kind]?.name}`)
  }
  // ---- задания ----
  const claimDaily = () => {
    if (!dailyReady) return
    const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10)
    const streak = save.daily.last === yesterday ? (save.daily.streak % 7) + 1 : 1
    commit(s => ({ ...s, daily: { last: todayKey(), streak }, xp: (s.xp || 0) + DAILY_XP }))
    setNotice(`Ежедневный вход: день ${streak} из 7`)
  }
  const claimTask = (t: (typeof TASKS)[number]) => {
    if (save.tasks[t.id] || (save.stats[t.stat] || 0) < t.target) return
    commit(s => ({ ...s, tasks: { ...s.tasks, [t.id]: true }, xp: (s.xp || 0) + TASK_XP }))
    setNotice(`Задание выполнено: ${t.title} · +${TASK_XP} XP`)
  }
  // достижения выдаются автоматически, как только условие выполнено
  useEffect(() => {
    const fresh = ACHIEVEMENTS.filter(a => !(save.ach || {})[a.id] && a.test(save.stats))
    if (!fresh.length) return
    commit(s => ({ ...s, ach: { ...(s.ach || {}), ...Object.fromEntries(fresh.map(a => [a.id, true])) }, xp: (s.xp || 0) + fresh.reduce((n, a) => n + a.xp, 0) }))
    setNotice(`Достижение: ${fresh[0].title} · +${fresh[0].xp} XP${fresh.length > 1 ? ` (и ещё ${fresh.length - 1})` : ''}`)
  }, [save.stats, save.ach, commit])
  const lvl = levelInfo(save.xp || 0)
  const lvlRef = useRef(lvl.level)
  useEffect(() => {
    if (lvl.level > lvlRef.current) setNotice(`Новый уровень: ${lvl.level} · ${rankOf(lvl.level)}`)
    lvlRef.current = lvl.level
  }, [lvl.level])
  const reset = () => {
    if (!window.confirm('Сбросить весь прогресс?')) return
    const d = defaultSave(); S.current = d; setSave(d); persist(d); setNotice('Прогресс сброшен')
  }

  const view = (g: GameId) => {
    switch (g) {
      case 'rocket': return <Crash ctx={ctx} />
      case 'upgrade': return <Upgrade ctx={ctx} seed={seed} />
      case 'storm': return <Storm ctx={ctx} />
      case 'slots': return <Slots ctx={ctx} />
      case 'cases': return <Cases ctx={ctx} caseId={seed} />
      case 'mines': return <Mines ctx={ctx} />
      case 'plinko': return <Plinko ctx={ctx} />
      case 'blackjack': return <Blackjack ctx={ctx} />
      case 'mansion': return <Mansion ctx={ctx} />
      case 'coin': return <Coinflip ctx={ctx} />
      default: return <p className="m center">Режим появится позже.</p>
    }
  }


  const header = (
    <header className="topbar">
      {game
        ? <button className="back-btn" onClick={() => setGame(null)} aria-label="Назад"><ChevronLeft size={20} /><span>{TITLES[game]}</span></button>
        : <button className="brand" onClick={() => setTab('Игры')}><span className="brand-word">Qc<span>Up</span></span></button>}
      <div className="top-actions">
        {DEMO && <span className="demo-badge">ДЕМО</span>}
        {!game && (DEMO
          ? <button className="dep-btn" onClick={() => { commit(s => ({ ...s, balance: s.balance + 10000, tx: [{ id: uid(), title: 'Демо-пополнение', amount: 10000, date: dateNow() }, ...s.tx].slice(0, 60) })); setNotice('Демо: +10 000 ⭐') }}><Plus size={15} />+10 000</button>
          : <button className="dep-btn" onClick={() => setDepositOpen(true)}><Plus size={15} />Пополнить</button>)}
        <button className="settings-btn" aria-label="Звук" onClick={() => setSound(s => !s)}>{sound ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>
        <div className="cur-wrap">
          <button className="balance-pill" onClick={() => setCurMenu(o => !o)} aria-haspopup="menu" aria-expanded={curMenu}>{cur === 'TON' && rates ? <TonIcon size={18} /> : cur === 'USDT' && rates ? <UsdtIcon size={18} /> : <Coin />}<b>{fmtBal(save.balance)}</b><span className="cur-caret">▾</span></button>
          {curMenu && <><div className="cur-back" onClick={() => setCurMenu(false)} /><div className="cur-menu" role="menu">
            {([['STAR', 'Звёзды', <Coin size={18} />], ['TON', 'TON', <TonIcon size={18} />], ['USDT', 'USDT', <UsdtIcon size={18} />]] as ['STAR' | 'TON' | 'USDT', string, ReactNode][]).map(([k, t, ic]) =>
              <button key={k} role="menuitem" className={`cur-item ${cur === k ? 'on' : ''}`} onClick={() => pickCur(k)}>{ic}<span>{t}</span>{cur === k && <em>✓</em>}</button>)}
            <button role="menuitem" className="cur-prof" onClick={() => { setCurMenu(false); setGame(null); setTab('Профиль') }}>Профиль</button>
          </div></>}
        </div>
        <button className="avatar" onClick={() => { setGame(null); setTab('Профиль') }} aria-label={`Профиль, уровень ${lvl.level}`}>
          {user?.photo_url ? <img src={user.photo_url} alt="" /> : displayName.slice(0, 1).toUpperCase()}<span className="lvl-chip">{lvl.level}</span>
        </button>
      </div>
    </header>
  )

  return <main className="app-shell">
    <div className="bg-glow" />
    {header}

    {game ? <section className="game-view">{view(game)}</section> : <>
      {tab === 'Игры' && <>
        <button className={`daily-banner ${dailyReady ? 'ready' : ''}`} onClick={() => setTab('Задания')}>
          <div><b>Ежедневный вход</b><span>{dailyReady ? 'Отметь визит' : 'Отмечено, приходи завтра'} · день {Math.max(1, save.daily.streak)} из 7</span></div>
          <i>{dailyReady ? 'Отметить' : '✓'}</i>
        </button>
        <section className="game-grid">
          {games.map(g => (
            <button className={`game-card${g.soon ? ' coming' : ''}`} key={g.id} onClick={() => g.soon ? setNotice('Этот режим скоро появится') : g.id === 'cases' ? setTab('Кейсы') : openGame(g.id)}>
              <div className="card-art-wrap"><img src={`./games/${g.image}.webp`} alt="" /><div className="card-glare" /></div>
              {!g.soon && <span className="players"><i /> {g.players} играют</span>}
              {g.tag && <span className={`game-tag ${g.tag}`}>{g.tag}</span>}
              <b>{g.name}</b><p className="card-desc">{g.desc}</p>
            </button>
          ))}
        </section>
      </>}

      {tab === 'Кейсы' && <section className="page-section">
        <h1>Кейсы</h1><p className="muted">Из кейса выпадает подарок. Его можно оставить, продать или улучшить.</p>
        <div className="case-list">
          {CASES.map(c => (
            <button key={c.id} className="case-card" style={{ ['--cc' as string]: c.color }} onClick={() => openGame('cases', c.id)}>
              <CaseIcon pool={c.pool} />
              <b>{c.name}</b>
              <span className="muted">от {money(GIFTS[c.pool[0]]?.base || 0)} до {money(GIFTS[c.pool[c.pool.length - 1]]?.base || 0)}</span>
              <span className="case-price">{money(c.price)} ⭐</span>
            </button>
          ))}
        </div>
      </section>}

      {tab === 'Подарки' && <GiftsTab save={save} ctx={ctx} onBuy={buy} onSell={sell} onUpgrade={uid => openGame('upgrade', uid)} />}

      {tab === 'Задания' && <section className="page-section">
        <h1>Задания</h1>
        <div className="daily-card">
          <div className="daily-top"><b>Ежедневный вход</b><span className="m small">Серия: {save.daily.streak} из 7</span></div>
          <div className="daily-days">{DAILY.map((r, i) => <span key={i} className={i < save.daily.streak ? 'done' : ''}><small>{i + 1}</small>{r}</span>)}</div>
          <button className="primary-btn wide" disabled={!dailyReady} onClick={claimDaily}>{dailyReady ? 'Отметить вход' : 'Отмечено, приходи завтра'}</button>
        </div>
        <div className="week-note m small">Лучшие по рейтингу недели получают настоящие подарки Telegram. Звёзды и подарки внутри игры вывести нельзя.</div>
        {TASKS.map(t => {
          const p = Math.min(t.target, save.stats[t.stat] || 0), done = !!save.tasks[t.id], ready = p >= t.target && !done
          return <div className="task-card" key={t.id}>
            <div><b>{t.title}</b><small>{t.hint()} · +{TASK_XP} XP</small>
              <div className="bar"><i style={{ width: `${(p / t.target) * 100}%` }} /></div></div>
            <strong>{p}/{t.target}</strong>
            <button disabled={!ready} onClick={() => claimTask(t)}>{done ? 'Готово' : ready ? 'Отметить' : 'В процессе'}</button>
          </div>
        })}
      </section>}

      {tab === 'Профиль' && <section className="page-section">
        <div className="profile-head"><div className="profile-avatar">{user?.photo_url ? <img src={user.photo_url} alt="" /> : displayName.slice(0, 1).toUpperCase()}</div>
          <div><h1>{displayName}</h1><p className="muted">{user?.username ? '@' + user.username : 'Гость'}</p></div></div>
        <div className="lvl-card">
          <div className="lvl-top"><div className="lvl-badge">{lvl.level}</div>
            <div><b>Уровень {lvl.level} · {rankOf(lvl.level)}</b><small>{lvl.need ? `${lvl.into} / ${lvl.need} XP до уровня ${lvl.level + 1}` : 'Максимальный уровень'}</small></div></div>
          <div className="lvl-bar"><i style={{ width: `${Math.round(lvl.pct * 100)}%` }} /></div>
          <p className="m small">Опыт: ставки (+2 за раунд и ещё за каждые 25 ⭐), задания +{TASK_XP}, ежедневный вход +{DAILY_XP}, достижения. Наград за уровни пока нет.</p>
        </div>
        <div className="stats-row">
          <div><b>{fmtBal(save.balance)}</b><small>{cur === 'STAR' ? 'Звёзды' : 'Баланс'}</small></div>
          <div><b>{save.gifts.length}</b><small>Подарков</small></div>
          <div><b>{save.stats.rounds || 0}</b><small>Раундов</small></div>
        </div>
        <h2 className="section-title">Достижения · {Object.keys(save.ach || {}).length}/{ACHIEVEMENTS.length}</h2>
        <div className="ach-grid">
          {ACHIEVEMENTS.map(a => { const got = !!(save.ach || {})[a.id]; return (
            <div key={a.id} className={`ach ${got ? 'got' : ''}`}><span className="ach-ic">{a.icon}</span>
              <b>{a.title}</b><small>{a.desc}</small><em>{got ? 'Получено' : `+${a.xp} XP`}</em></div>) })}
        </div>
        <h2 className="section-title">Операции</h2>
        <TransactionList items={save.tx.slice(0, 20)} />
        <p className="fine-print">{DEMO ? 'Демо-версия для тестов: звёзды и подарки виртуальные, платежей нет, прогресс хранится отдельно от основной игры. «+10 000» вверху добавляет звёзды.' : 'Звёзды игры внутриигровые (1 звезда игры = 1 звезда по рыночному курсу) и не являются Telegram Stars. Баланс пополняется в TON или USDT, подарки существуют только внутри игры. Прогресс хранится в этом браузере.'}</p>
        {demoOk && <div className="demo-card">
          <b>Демо-режим (только для владельца)</b>
          <span>Тестовые звёзды, не связаны с платежами</span>
          <div className="demo-row">
            {[1000, 10000, 100000].map(n => <button key={n} onClick={() => { commit(s => ({ ...s, balance: s.balance + n, tx: [{ id: uid(), title: 'Демо-пополнение', amount: n, date: dateNow() }, ...s.tx].slice(0, 60) })); setNotice(`Демо: +${money(n)} ⭐`) }}>+{money(n)}</button>)}
            <button className="danger" onClick={() => { commit(s => ({ ...s, balance: 0 })); setNotice('Баланс обнулён') }}>Обнулить</button>
          </div>
        </div>}
        <h2 className="section-title">Правила игры</h2>
        <p className="fine-print">Во всех играх отдача игроку ниже 100%: казино всегда в плюсе, как и в настоящих. Если игрок долго выигрывает больше обычного, шансы в играх понемногу ухудшаются. Так игра показывает, что у казино нельзя выиграть в долгую.</p>
        <button className="outline-btn" onClick={reset}>Сбросить прогресс</button>
      </section>}

      <nav className="bottom-nav">{tabs.map(({ label, icon: Icon }) =>
        <button key={label} className={tab === label ? 'nav-item active' : 'nav-item'} onClick={() => setTab(label)}>
          <Icon size={17} /><span>{label}</span>{label === 'Задания' && dailyReady && <em className="dot" />}
        </button>)}</nav>
    </>}

    {depositOpen && <DepositModal onClose={() => setDepositOpen(false)} onNotice={setNotice} />}
    {notice && <button className="toast" onClick={() => setNotice('')}>{notice}<X size={15} /></button>}
    <Confetti count={confetti} key={confetti} />
  </main>
}

function CaseIcon({ pool }: { color?: string; id?: string; pool: string[] }) {
  const pick = [pool[Math.floor((pool.length - 1) / 2)], pool[pool.length - 1], pool[Math.max(0, Math.floor((pool.length - 1) / 4))]]
  const uniq = pick.filter((k, i) => pick.indexOf(k) === i)
  return (
    <div className="case-icon">
      <div className="case-aura" />
      <div className="case-row" style={{ gridTemplateColumns: `repeat(${uniq.length}, 50px)` }}>
        {uniq.map((k, i) => <div key={k} className={`ci ${uniq.length === 3 ? `ci${i}` : 'ci1'}`}><GiftArt kind={k} size={50} glow={false} /></div>)}
      </div>
    </div>
  )
}

function GiftsTab({ save, ctx, onBuy, onSell, onUpgrade }: { save: Save; ctx: Ctx; onBuy: (k: GiftKind) => void; onSell: (g: GiftT) => void; onUpgrade: (uid: string) => void }) {
  const [sub, setSub] = useState<'mine' | 'market'>('mine')
  const [kindF, setKindF] = useState<'gift' | 'nft'>('gift')
  const imported = GIFT_ORDER.some(k => !!GIFTS[k].thumb || /★/.test(GIFTS[k].name))
  const worth = save.gifts.reduce((a, g) => a + save.prices[g.kind], 0)
  return <section className="page-section">
    <h1>Подарки</h1>
    <div className="subtabs"><button className={sub === 'mine' ? 'on' : ''} onClick={() => setSub('mine')}>Мои</button><button className={sub === 'market' ? 'on' : ''} onClick={() => setSub('market')}>Маркет</button></div>
    {sub === 'mine' ? <>
      <div className="gift-sum"><span>{save.gifts.length} подарков</span><span>оценка {money(worth)}</span></div>
      {!save.gifts.length && <div className="empty-history">Пока пусто. Загляни на маркет или открой кейс.</div>}
      {save.gifts.map(g => <div className="gift-row" key={g.uid}>
        <GiftArt kind={g.kind} size={48} />
        <div><b>{GIFTS[g.kind]?.name} #{g.num}</b><small>{GIFTS[g.kind].rarity}</small></div>
        <div className="gift-act"><strong>{money(save.prices[g.kind])}</strong>
          <span><button onClick={() => onUpgrade(g.uid)}>Апгрейд</button><button onClick={() => onSell(g)}>Продать</button></span></div>
      </div>)}
    </> : <>
      <div className="gift-sum"><span>Цена в звёздах</span><span>продажа −{Math.round((1 - SELL_RATE) * 100)}%</span></div>
      <div className="subtabs slim"><button className={kindF === 'gift' ? 'on' : ''} onClick={() => setKindF('gift')}>Подарки</button>
        <button className={kindF === 'nft' ? 'on' : ''} onClick={() => setKindF('nft')}>NFT{GIFT_ORDER.some(k => GIFTS[k].nft) ? '' : ' (нет данных)'}</button></div>
      {kindF === 'nft' && !GIFT_ORDER.some(k => GIFTS[k].nft) && <div className="empty-history">NFT пока не загружены (нет доступа к интернету или к GitHub). Положи nft.json в public/gifts или запусти через бэкенд.</div>}
      {GIFT_ORDER.filter(k => !!GIFTS[k].nft === (kindF === 'nft')).map(k => {
        const p = save.prices[k], o = save.priceOpen.prices[k], d = ((p - o) / o) * 100
        return <div className="gift-row" key={k}>
          <GiftArt kind={k} size={48} />
          <div><b>{GIFTS[k]?.name}</b><small>{GIFTS[k].rarity}</small></div>
          <div className="gift-act"><strong>{money(p)}</strong>{GIFTS[k].nft && <small>≈ {(p / COINS_PER_TON).toFixed(p / COINS_PER_TON < 10 ? 2 : 1).replace('.', ',')} TON</small>}<span className={d >= 0 ? 'up' : 'down'}>{d >= 0 ? '+' : '−'}{Math.abs(d).toFixed(1).replace('.', ',')}% за день</span>
            <span><button disabled={save.balance < p} onClick={() => onBuy(k)}>Купить</button></span></div>
        </div>
      })}
      {FLAGS.demo && <p className="fine-print demo">Демо-данные: иконки, названия и цены NFT сгенерированы для тестов и колеблются случайно. Настоящие появятся после импорта каталога из бота.</p>}
      {GIFT_ORDER.some(k => GIFTS[k].nft) && <p className="fine-print">Цены NFT: флоры Fragment по данным «Telegram gifts floor prices» (Baltic Assets, balticassets.eu) и «Telegram Gifts and Stars Dataset» (Gift Club), CC BY 4.0, обновляются раз в сутки.</p>}
      <p className="fine-print">{imported
        ? `Каталог импортирован из Telegram: ${GIFT_ORDER.length} подарков, цена в звёздах равна цене в Telegram (1★ = ${STARS_TO_COINS} звезда игры). Внутриигровые подарки на настоящие не обмениваются.`
        : 'Сейчас встроенный набор. Чтобы подтянуть настоящие подарки Telegram, запусти скрипт import-gifts (см. README).'}</p>
      <p className="fine-print">Цены внутри игры колеблются около базовых значений. {ctx.save.gifts.length ? '' : 'Купи подарок и попробуй апгрейд.'}</p>
    </>}
  </section>
}

function TransactionList({ items }: { items: Tx[] }) {
  if (!items.length) return <div className="empty-history">Пока нет операций</div>
  return <div className="tx-list">{items.map(tx => <div className="tx-row" key={tx.id}>
    <span className={tx.amount >= 0 ? 'tx-icon plus' : 'tx-icon'}>{tx.amount >= 0 ? <ArrowDownLeft size={16} /> : <ArrowUpRight size={16} />}</span>
    <div><b>{tx.title}</b><small>{tx.date}</small></div>
    <strong className={tx.amount > 0 ? 'positive' : ''}>{tx.amount === 0 ? 'подарок' : `${tx.amount > 0 ? '+' : ''}${money(tx.amount)}`}</strong>
  </div>)}</div>
}

function Confetti({ count }: { count: number }) {
  const pieces = useMemo(() => count <= 0 ? [] : Array.from({ length: 26 }, () => ({
    x: 50 + (Math.random() - 0.5) * 70, c: `hsl(${Math.floor(Math.random() * 360)},80%,60%)`, s: Math.random() * 6 + 3, d: Math.random() * 0.4,
  })), [count])
  return <div className="confetti-layer">{pieces.map((p, i) => <div key={i} className="confetti-piece" style={{ left: `${p.x}%`, background: p.c, width: p.s, height: p.s, animationDelay: `${p.d}s` }} />)}</div>
}
