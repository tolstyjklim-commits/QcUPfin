import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cfmt, GIFTS, GIFT_ORDER } from './lib'
import { GiftArt } from './art'
import { serverGet, serverPost } from './deposit'

/* ───────── Лента выигрышей ─────────
   Компактное окошко на главном экране: новые записи сверху, старые уезжают вниз и гаснут.
   Три вида записей: обычный выигрыш, подарок (апгрейд, кейс, колесо) и редкий крупный выигрыш.
   Ваши настоящие выигрыши и подарки приходят событиями qcup-win и qcup-gift (см. App). */
type Kind = 'win' | 'gift'
type Entry = { id: number; real?: boolean; kind: Kind; name: string; game: string; amount: number; mult: number; gift?: string; big?: boolean; me?: boolean }

const NAMES = ['бустер', 'kwixly', 'бессердечный', 'holy_shit', 'sxdboy', 'n1ghtmare', 'ctrl+z', 'лунатик', 'dr0pper', 'пельмень', 'кринж', 'lowkey', 'vanilla.sky', 'toxic_vibe', 'p1xel', 'хз кто я', 'буба', 'кобильджон', 'грязнулька', '9mice', 'vibe_check', 'darkside', 'чебурек', 'fr3sh', 'мистер_твистер', '7ghosts', '1nsomnia', '4eburek', '0xfade', 'lisenok', 'x3ro', 'k0stya', 'm0rtis', 'ghostface', 'нокиа3310', 'мемный_дед', 'silent.hill', 'кислый', 'крипер', 'no_sleep', 'тень', 'lil_pump_ru', 'sweetie', 'жёлтый_лист', 'mr.nobody', 'рандом', 'хлебушек', 'mad_max99', 'fluffy', 'ананас', 'стаканчик', 'nightowl', 'бананчик', 'синька', 'wasted.youth', 'глитч', 'frostbite', 'дыня', 'zaza_boy', 'lunar.eclipse', 'дима с района', 'каспер', 'trashcan', 'мышонок', 'b0mzh', 'kapibara', 'чил', 'chill_guy', 'ёжик в тумане', 'twitch_kid', 'snuff_box', 'аквариум', 'rose.gold', 'jumpscare', 'кефир', 'demon4ik', 'гоша 228', 'hype', 'ушастый', 'mellow', 'cyberpunk_ru', 'вафелька', 's1mple_fan', 'гречка', 'lazy_bear', 'dark.matter', 'сахарок', 'fluxx', 'lol_kek', 'шашлык', 'wolfie', 'niko.raw', 'ты кто такой', 'tilt', 'рыжий кот', 'frozen.mind', 'ботаник vip', 'crazy.frog', 'оливье', '4ikibriki', 'mono.chrome', 'хомяк_ёжик', 'kraken', 'мёд', 'nebula', 'бонд', 'iwannabe_rich', 'бегемот', '3dgy', '8ball', 'vlad_kuz', 'egor_bro', '5ad', 'vo1d', 'zarina', 'nuri', '2late', 'dilnoza', 'neon9', 'hxrt', 'c0ld', 'yaroslav', '6am', 'alisher', 'mxtro', 'd3ad', 's1lent', '1ce', '4ever.alone', 'n0pe', '0lga.exe', 'y0ung.ghost', '3am', 'olesya', 'kirya', 'zhora', 'fl0w', 'maxon', '2dead', '5ky', 'ph4ntom', 'z3n', '1mpulse', '8bit.heart', '9lives', 'winter_boy', 'sunny.side', 'moon_walker', 'late.night', 'coffee.addict', 'pixel.dust', 'no.cap', 'big.mood', 'just_vibing', 'cool_story', 'foggy', 'fast_food', 'mr.bean', 'silver.fox', 'red.panda', 'ice.cream', 'night.shift', 'lucky_one', 'dead.pool', 'snow.leopard', 'quiet.storm', 'lone_wolf', 'blue.moon', 'iron_man', 'odd.one', 'hot.chocolate', 'paper.plane', 'space.cadet', 'lost.soul', 'tiny.dancer', 'sour.candy', 'wild.card', 'true.story', 'bl00d', '7even', 'pro100_vasya', 'k1ll.me', 'xxx_dark_xxx', 'vampire_lord', 'noob_saibot', 'ex1t', 'sk1ll', 'cheater_no1', 'the_boss', 'hard.core', 'ez_win', 'lucky_luke', 'top1_global', 'casino_king', 'jackpot_ru', 'fortune.fox', 'all_in_boy', 'mega.win', 'spin_doctor', 'roll_dice', 'bet_master', 'gold.rush', 'crypto_kid', 'ton_hunter', 'nft_lover', 'hamster_ru', 'cold', 'coldzz', 'cyber', '0dd', 'r3al', '4nxious', 'darkkid', 'tr4sh', 'fox.2k', 'fox.pro', 'm1lk', 'ice_2k', '6ix', 'lost.in.3d', 'lazy', 'lazy__ru', 'lazy_man', 'gl1tch.girl', 'lilboy', '2pm', 'moon.2k', 'moon_boy', '1x.ghost', 'drxg', 'neo.2k', 'neo.boy', '0nline', 'neo2k', 'neo_king', '3rror', 'h0llow', 'neon2k', 'neon_man', 'w4ste', '8kid', 'night__ru', 'pixel', 'fr0st', '4real', 'pixel2k', 'pixelx', 'ca7', 'red2k']
const GAMES = ['Ракета', 'Мины', 'Башня', 'Кено', 'Колесо удачи', 'Плинко', 'Кости', 'Рулетка', 'Скретч', 'Шторм', 'Слоты']
const STAKES = [50, 100, 100, 200, 250, 500, 500, 1000, 2000]
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
// у части ников вместо буквы фото: выбор зависит только от ника, поэтому у одного ника аватарка всегда одна и та же
const photoFor = (s: string) => {
  const h = [...s].reduce((a, c) => (a * 131 + c.charCodeAt(0)) >>> 0, 17)
  return (h >> 5) % 5 < 3 ? `${(import.meta as any).env.BASE_URL}ava/a${(h >> 3) % 12 + 1}.webp` : ''
}
const PHOTOS = Array.from({ length: 12 }, (_, i) => `${(import.meta as any).env.BASE_URL}ava/a${i + 1}.webp`)
const bad = new Set<string>() // фото, которые не загрузились: для них показываем букву
function Ava({ name, src }: { name: string; src: string }) {
  const [fail, setFail] = useState(bad.has(src))
  if (src && src !== 'me' && !fail) return <img className="feed-ava" src={src} alt="" onError={() => { bad.add(src); setFail(true) }} />
  return <span className="feed-ava" style={{ background: `hsl(${hue(name)} 24% 30%)` }}>{src === 'me' ? name.slice(0, 1).toUpperCase() : '?'}</span>
}
const hue = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7)
let nextId = 1
const MAX_FAKE = 20_000 // выигрыши демо-игроков не выше 20 000 ⭐, чтобы не выглядело подозрительно
const BIG_GIFT = 1000 // подарок от 1000 ⭐ считается крупным выигрышем

const giftPool = () => GIFT_ORDER.filter(k => GIFTS[k] && !GIFTS[k].nft && !GIFTS[k].retired).sort((a, b) => GIFTS[a].base - GIFTS[b].base)
const nftPool = () => Object.keys(GIFTS).filter(k => GIFTS[k]?.nft).sort((a, b) => GIFTS[a].base - GIFTS[b].base)

// обычные выигрыши: чаще мелкие, крупные редко
function winEntry(): Entry {
  const r = Math.random()
  const mult = r < 0.66 ? 1.4 + Math.random() * 2.6 : 4 + Math.random() * 14
  const stake = pick(STAKES)
  const amount = Math.min(MAX_FAKE, Math.round(stake * mult))
  return { id: nextId++, kind: 'win', name: pick(NAMES), game: pick(GAMES), mult: Math.round((amount / stake) * 10) / 10, amount }
}
// подарки: апгрейд чаще всего, потом кейсы и колесо; дорогие подарки выпадают редко
function giftEntry(): Entry | null {
  const nft = nftPool(), pool = nft.length && Math.random() < 0.3 ? nft : giftPool(); if (!pool.length) return null
  const r = Math.random()
  const kind = pool[Math.min(pool.length - 1, Math.floor(Math.pow(Math.random(), r < 0.2 ? 1 : 1.9) * pool.length))]
  const src = Math.random()
  const game = src < 0.46 ? 'Апгрейд' : src < 0.82 ? 'Кейс' : 'Колесо удачи'
  const mult = game === 'Апгрейд' ? Math.round((1.3 + Math.random() * 4.5) * 10) / 10 : 0
  const big = GIFTS[kind].base >= BIG_GIFT
  return { id: nextId++, kind: 'gift', name: pick(NAMES), game, mult, amount: 0, gift: kind, big }
}
// крупный выигрыш: редкое событие с большим множителем
function bigEntry(): Entry {
  const amount = Math.round((6000 + Math.random() * (MAX_FAKE - 6000)) / 10) * 10, stake = pick([100, 100, 200, 250, 500])
  return { id: nextId++, kind: 'win', name: pick(NAMES), game: pick(['Ракета', 'Кено', 'Плинко', 'Рулетка', 'Мины']), mult: Math.round(amount / stake), amount, big: true }
}

const GAP_MS = 900, KEEP = 7, CHIP_GAP = 10 // между двумя записями минимум GAP_MS (чтобы успел отработать сдвиг); после неё лента сдвигается на одну карточку вправо

export function LiveFeed({ myName }: { myName: string }) {
  useEffect(() => { PHOTOS.forEach(p => { const i = new Image(); i.src = p }) }, []) // заранее подгружаем фото, чтобы они не появлялись с задержкой
  const [rows, setRows] = useState<Entry[]>(() => [winEntry(), winEntry(), winEntry(), winEntry()])
  const lastBig = useRef(Date.now() - 20_000)
  const queue = useRef<Entry[]>([])
  const lastSpawn = useRef(0)
  const timer = useRef(0)
  const track = useRef<HTMLDivElement>(null)
  const prevFirst = useRef(0)
  const flush = useRef<() => void>(() => {})
  flush.current = () => {
    if (!queue.current.length) return
    const wait = lastSpawn.current + GAP_MS - Date.now()
    if (wait > 0) { if (!timer.current) timer.current = window.setTimeout(() => { timer.current = 0; flush.current() }, wait); return }
    const e = queue.current.shift()!
    lastSpawn.current = Date.now()
    setRows(x => [e, ...x].slice(0, KEEP))
    if (queue.current.length) flush.current()
  }
  // лента стоит на месте; когда добавилась карточка слева, остальные одним плавным шагом сдвигаются вправо
  useLayoutEffect(() => {
    const el = track.current, last = el?.firstElementChild as HTMLElement | null
    if (!el || !last) return
    const newest = rows[0]?.id || 0
    if (prevFirst.current && newest !== prevFirst.current) {
      const w = last.offsetWidth + CHIP_GAP
      el.style.transition = 'none'; el.style.transform = `translateX(${-w}px)`
      void el.offsetWidth
      el.style.transition = 'transform .55s cubic-bezier(.3,.7,.2,1)'; el.style.transform = 'translateX(0)'
    }
    prevFirst.current = newest
  }, [rows])
  useEffect(() => {
    let t = 0
    const make = (): Entry => {
      const r = Math.random(), now = Date.now()
      if (r < 0.1 && now - lastBig.current > 50_000) { lastBig.current = now; return bigEntry() }
      return r < 0.42 ? giftEntry() || winEntry() : winEntry()
    }
    // темп случайный: то подряд через пару секунд, то долгая тишина; иногда сразу две записи
    const nextDelay = () => {
      const r = Math.random()
      if (r < 0.28) return 1500 + Math.random() * 1800   // быстро: 1.5–3.3 с
      if (r < 0.75) return 3500 + Math.random() * 5000   // средне: 3.5–8.5 с
      return 9000 + Math.random() * 8000                 // пауза: 9–17 с
    }
    const tick = () => {
      const n = Math.random() < 0.2 ? 2 : 1
      for (let i = 0; i < n && queue.current.length < 4; i++) queue.current.push(make())
      flush.current()
      t = window.setTimeout(tick, nextDelay())
    }
    t = window.setTimeout(tick, 4000)
    const onWin = (ev: Event) => {
      const d = (ev as CustomEvent<{ amount: number; mult: number; game: string }>).detail
      if (!d || d.amount < 200 || d.mult < 1.5) return
      queue.current.unshift({ id: nextId++, kind: 'win', name: myName || 'Вы', game: d.game, amount: Math.round(d.amount), mult: Math.round(d.mult * 10) / 10, me: true, big: d.mult >= 40 }); flush.current()
      void serverPost('/api/feed', { kind: 'win', game: d.game, amount: Math.round(d.amount), mult: Math.round(d.mult * 10) / 10 }) // покажем выигрыш и другим игрокам
    }
    const onGift = (ev: Event) => {
      const d = (ev as CustomEvent<{ kind: string; game: string }>).detail
      if (!d?.kind || !GIFTS[d.kind]) return
      queue.current.unshift({ id: nextId++, kind: 'gift', name: myName || 'Вы', game: d.game, amount: 0, mult: 0, gift: d.kind, me: true }); flush.current()
      if (GIFTS[d.kind].base >= BIG_GIFT) void serverPost('/api/feed', { kind: 'gift', game: d.game, gift: d.kind }) // другим показываем только крупные подарки
    }
    // настоящие выигрыши других игроков с сервера: раз в 15 секунд забираем новые и ставим в очередь вместе с демо-записями
    let since = Date.now() - 30 * 60_000, poll = 0, dead = false
    type Srv = { id: string; kind: Kind; name: string; game: string; amount: number; mult: number; gift?: string; at: number; mine?: boolean }
    const pull = async () => {
      const rows = await serverGet<Srv[]>(`/api/feed?since=${since}`)
      if (dead) return
      for (const r of rows || []) {
        since = Math.max(since, r.at)
        if (r.mine || (r.kind === 'gift' && (!r.gift || !GIFTS[r.gift])) || queue.current.length >= 6) continue
        queue.current.push({ id: nextId++, real: true, kind: r.kind, name: r.name, game: r.game, amount: r.amount, mult: r.mult, gift: r.gift, big: r.kind === 'win' ? r.mult >= 40 || r.amount >= 10_000 : !!r.gift && GIFTS[r.gift].base >= BIG_GIFT })
      }
      flush.current()
      poll = window.setTimeout(pull, 15_000)
    }
    poll = window.setTimeout(pull, 2500)
    window.addEventListener('qcup-win', onWin); window.addEventListener('qcup-gift', onGift)
    return () => { dead = true; clearTimeout(poll); clearTimeout(t); clearTimeout(timer.current); timer.current = 0; window.removeEventListener('qcup-win', onWin); window.removeEventListener('qcup-gift', onGift) }
  }, [myName])
  // фото раздаются так, чтобы среди видимых карточек одна и та же аватарка не повторялась у разных ников
  const avaCache = useRef(new Map<number, string>())
  const avas = (() => {
    const m = avaCache.current, live = new Set(rows.map(r => r.id))
    for (const k of [...m.keys()]) if (!live.has(k)) m.delete(k)
    const used = new Set(m.values())
    for (const e of [...rows].reverse()) {
      if (m.has(e.id)) continue
      const same = rows.find(r => r.name === e.name && m.get(r.id)) // тот же ник уже на экране: у него та же аватарка
      let p = same ? m.get(same.id)! : e.me ? '' : photoFor(e.name)
      if (p && !same && used.has(p)) {
        const start = PHOTOS.indexOf(p); p = ''
        for (let i = 1; i < PHOTOS.length; i++) { const q = PHOTOS[(start + i) % PHOTOS.length]; if (!used.has(q)) { p = q; break } }
      }
      m.set(e.id, p); if (p) used.add(p)
    }
    return m
  })()
  return <section className="feed" aria-label="Лента выигрышей">
    <div className="feed-head"><b>Лента выигрышей</b><span className="feed-live"><i />в эфире · демо</span></div>
    <div className="tk">
      <div className="tk-track" ref={track}>
        {rows.map(e => <div key={e.id} className={`tk-chip ${e.me ? 'me' : ''} ${e.big ? 'big' : ''}`}>
          <Ava name={e.name} src={e.me ? 'me' : avas.get(e.id) || ''} />
          <span className="feed-who"><b>{e.me ? 'Вы' : e.name}</b><small>{e.big ? 'Крупный · ' : ''}{e.game}{e.kind === 'gift' && e.mult ? ` ×${e.mult}` : ''}</small></span>
          {e.kind === 'gift' && e.gift
            ? <span className="feed-gift"><GiftArt kind={e.gift} size={32} glow={false} /></span>
            : <span className="feed-win"><b>+{cfmt(e.amount)}</b><small>×{e.mult}</small></span>}
        </div>)}
      </div>
    </div>
  </section>
}

/* ───────── Рефералка ─────────
   Ссылка открывает игру с параметром ref_<id>. Сервер при первом входе запоминает пригласившего и начисляет ему
   процент от пополнений друга. Без сервера (демо) показываем ссылку и нули. */
type RefInfo = { invited: number; earned: number; percent: number }
const BOT = ((import.meta as any).env?.VITE_BOT_USERNAME as string) || 'QcUpBot'

export function ReferralCard({ onNotice }: { onNotice: (s: string) => void }) {
  const tg = (window as any).Telegram?.WebApp
  const id = tg?.initDataUnsafe?.user?.id
  const [info, setInfo] = useState<RefInfo>({ invited: 0, earned: 0, percent: 5 })
  const link = `https://t.me/${BOT}?startapp=ref_${id || 'demo'}`
  useEffect(() => { void serverGet<RefInfo>('/api/referrals').then(j => { if (j) setInfo(j) }) }, [])
  const copy = () => navigator.clipboard?.writeText(link).then(() => onNotice('Ссылка скопирована'))
  const share = () => {
    const text = 'Заходи в QcUp: мини-игры и подарки'
    const u = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`
    if (tg?.openTelegramLink) tg.openTelegramLink(u); else window.open(u, '_blank')
  }
  return <section className="ref-card">
    <div className="ref-top"><div><b>Приглашай друзей</b><small>Получай {info.percent}% от каждого их пополнения</small></div></div>
    <div className="ref-stats"><div><b>{info.invited}</b><small>приглашено</small></div><div><b>{cfmt(info.earned)}</b><small>заработано</small></div></div>
    <button className="ref-link" onClick={copy}><span>{link}</span><em>Копировать</em></button>
    <button className="primary-btn wide" onClick={share}>Поделиться ссылкой</button>
  </section>
}
