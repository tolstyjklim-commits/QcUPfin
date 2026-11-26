import { useEffect, useMemo, useRef, useState } from 'react'
import { Burst } from './fx'
import { HubCap } from './brand'
import { play } from './sfx'
import { rint, money, cfmt } from './lib'
import { Result, StakeInput } from './games'
import { Icon } from './icons'
import type { IconName } from './icons'
import { GiftArt } from './art'
import { GIFTS, GIFT_ORDER } from './lib'
import type { Ctx } from './games'

// Все четыре игры устроены одинаково честно: результат выбирается один раз до анимации, показанный шанс равен реальному,
// коэффициент = отдача ÷ шанс (округление вниз до сотых), отдача всегда ниже 100%. Выигрыш выдаётся, даже если игрок ушёл с экрана.
const RTP = 0.84
const fm = (v: number) => (Math.round(v * 100) / 100).toString().replace('.', ',')
const pct = (p: number) => (p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p >= 0.1 ? p.toFixed(2) : p.toFixed(3)).replace('.', ',') + '%'

// ============================== КОСТИ ==============================
const PIPS: Record<number, number[]> = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }
// какая грань смотрит на игрока: 1 спереди, 6 сзади, 3 справа, 4 слева, 2 сверху, 5 снизу (противоположные дают 7)
const FACE_ROT: Record<number, [number, number]> = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 2: [-90, 0], 5: [90, 0] }
function Die({ v, seq, i, win }: { v: number; seq: number; i: number; win?: boolean | null }) {
  const [bx, by] = FACE_ROT[v] || [0, 0]
  // кубик каждый бросок делает несколько полных оборотов и останавливается нужной гранью
  const rx = bx + 360 * seq * 2, ry = by + 360 * (seq * 3 + i)
  return (
    <div className={`die3 ${win === true ? 'win' : win === false ? 'lose' : ''}`} style={{ ['--dir' as string]: i === 0 ? -1 : 1, ['--delay' as string]: `${i * 0.09}s` }}>
      <div className={`die-throw ${seq ? `t${seq % 2}` : ''}`}>
        <div className="cube" style={{ transform: `rotateX(${rx}deg) rotateY(${ry}deg)` }}>
          {[1, 2, 3, 4, 5, 6].map(n => <div key={n} className={`die-face f${n}`}>{Array.from({ length: 9 }, (_, k) => <i key={k} className={PIPS[n].includes(k) ? 'on' : ''} />)}</div>)}
        </div>
      </div>
      <span className={`die-shadow ${seq ? `t${seq % 2}` : ''}`} />
    </div>
  )
}
const MAX_DICE_P = 0.83 // выше этого коэффициент упал бы ниже ×1,01

export function Dice({ ctx }: { ctx: Ctx }) {
  const [two, setTwo] = useState(false)
  const [sel, setSel] = useState<number[]>([4, 5, 6])
  const [stake, setStake] = useState(50)
  const [faces, setFaces] = useState<[number, number]>([3, 5])
  const [rolling, setRolling] = useState(false)
  const [seq, setSeq] = useState(0) // номер броска: от него зависит анимация
  const [res, setRes] = useState<{ ok: boolean; text: string; tier: number } | null>(null)
  const [last, setLast] = useState<{ v: number; ok: boolean }[]>([])
  const timers = useRef<number[]>([])
  const pending = useRef<{ w: number } | null>(null)
  const ctxRef = useRef(ctx); ctxRef.current = ctx
  useEffect(() => () => {
    timers.current.forEach(t => { clearTimeout(t); clearInterval(t) })
    const p = pending.current
    if (p) { pending.current = null; if (p.w > 0) ctxRef.current.pay(p.w, 'Кости — выигрыш') }
  }, [])
  const vals = two ? [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] : [1, 2, 3, 4, 5, 6]
  const ways = (v: number) => (two ? 6 - Math.abs(v - 7) : 1)
  const total = two ? 36 : 6
  const chance = sel.reduce((a, v) => a + ways(v), 0) / total
  const mult = Math.max(1.01, Math.floor((RTP / Math.max(chance, 0.0001)) * 100) / 100)
  const winPay = Math.floor(stake * mult)
  const setMode = (t: boolean) => { if (rolling) return; setTwo(t); setSel(t ? [8, 9, 10, 11, 12] : [4, 5, 6]); setRes(null); play.click() }
  const toggle = (v: number) => {
    if (rolling) return
    const has = sel.includes(v)
    if (has && sel.length === 1) return
    const next = has ? sel.filter(x => x !== v) : [...sel, v].sort((a, b) => a - b)
    const p = next.reduce((a, x) => a + ways(x), 0) / total
    if (p > MAX_DICE_P) { ctx.notify('Слишком большой шанс: коэффициент упал бы ниже ×1,01'); return }
    setSel(next); play.tick()
  }
  const presets: { t: string; v: number[] }[] = two
    ? [{ t: 'Меньше 7', v: [2, 3, 4, 5, 6] }, { t: 'Ровно 7', v: [7] }, { t: 'Больше 7', v: [8, 9, 10, 11, 12] }, { t: 'Чёт', v: [2, 4, 6, 8, 10, 12] }, { t: 'Нечёт', v: [3, 5, 7, 9, 11] }]
    : [{ t: '1–3', v: [1, 2, 3] }, { t: '4–6', v: [4, 5, 6] }, { t: 'Чёт', v: [2, 4, 6] }, { t: 'Нечёт', v: [1, 3, 5] }, { t: 'Одно', v: [6] }]
  const roll = () => {
    if (rolling || !ctx.charge(stake, 'Кости — ставка')) return
    ctx.bump('dice'); play.click()
    const a = 1 + rint(6), b = 1 + rint(6)
    const v = two ? a + b : a
    const ok = sel.includes(v)
    const w = ok ? Math.floor(stake * mult) : 0
    pending.current = { w }
    setFaces([a, b]); setSeq(n => n + 1) // кубики сразу «знают» итог, а зритель видит бросок, три отскока и остановку
    setRolling(true); setRes(null)
    const fl = window.setInterval(() => play.roll(), 95) // перестук катящихся кубиков
    timers.current.push(fl)
    ;[480, 840, 1170].forEach((ms, k) => timers.current.push(window.setTimeout(() => play.bounce(k * 3), ms))) // отскоки
    timers.current.push(window.setTimeout(() => {
      clearInterval(fl); pending.current = null
      setRolling(false); play.thud()
      setLast(h => [{ v, ok }, ...h].slice(0, 12))
      if (ok) {
        ctx.pay(w, 'Кости — выигрыш')
        const tier = mult >= 10 ? 3 : mult >= 4 ? 2 : 1
        if (tier === 3) play.jackpot(); else if (tier === 2) play.big(); else play.chime(1)
        setRes({ ok: true, tier, text: `Выпало ${two ? `${a} + ${b} = ${v}` : v}. Выигрыш +${cfmt(w)} (×${fm(mult)})` })
      } else { play.lose(); setRes({ ok: false, tier: 0, text: `Выпало ${two ? `${a} + ${b} = ${v}` : v}. Ставка сгорела` }) }
    }, 1500))
  }
  const done = !rolling && res
  return (
    <div className="dice-game">
      <div className="chips">{last.length ? last.map((h, i) => <span key={i} className="g" style={{ color: h.ok ? '#7bd88f' : '#ff8a8a' }}>{h.v}</span>) : <span className="m small">Прошлые броски появятся здесь</span>}</div>
      <div className={`dice-table ${rolling ? 'rolling' : ''} ${done ? (res!.ok ? 'win' : 'lose') : ''}`}>
        <div className="dice-felt" />
        <div className="dice-row">
          <Die v={faces[0]} seq={seq} i={0} win={done ? res!.ok : null} />
          {two && <Die v={faces[1]} seq={seq} i={1} win={done ? res!.ok : null} />}
        </div>
        {done && res!.ok && <Burst key={`d${last.length}`} type={res!.tier === 3 ? 'confetti' : 'gold'} n={res!.tier === 3 ? 180 : res!.tier === 2 ? 100 : 55} />}
      </div>
      {res && <Result good={res.ok}>{res.text}</Result>}
      <div className="hl-modes two"><button className={!two ? 'on' : ''} disabled={rolling} onClick={() => setMode(false)}>Один кубик</button><button className={two ? 'on' : ''} disabled={rolling} onClick={() => setMode(true)}>Сумма двух</button></div>
      <div className="hl-ctl">
        <div className="hl-row"><span>Ставка на {two ? 'суммы' : 'грани'} (нажимай, чтобы выбрать)</span><b>{pct(chance * 100)}</b></div>
        <div className={`dice-sel ${two ? 'two' : ''}`}>
          {vals.map(v => <button key={v} className={sel.includes(v) ? 'on' : ''} disabled={rolling} onClick={() => toggle(v)}>{v}{two && <small>{ways(v)}/36</small>}</button>)}
        </div>
        <div className="hl-presets five">{presets.map(p => <button key={p.t} className={p.v.length === sel.length && p.v.every(x => sel.includes(x)) ? 'on' : ''} disabled={rolling} onClick={() => { setSel(p.v); play.click() }}>{p.t}</button>)}</div>
      </div>
      <div className="hl-info"><div><small>Коэффициент</small><b>×{fm(mult)}</b></div><div><small>Выигрыш</small><b>{cfmt(winPay)}</b></div><div><small>Шанс</small><b>{pct(chance * 100)}</b></div></div>
      <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={rolling} />
      <button className="cta" disabled={rolling} onClick={roll}>{rolling ? 'Кубики катятся…' : `Бросить · ${cfmt(stake)}`}</button>
      <p className="m small center">Кубики честные: каждая грань выпадает с равным шансом. Чем меньше выбранных значений, тем выше коэффициент.</p>
    </div>
  )
}

// ============================== КОЛЕСО УДАЧИ ==============================
type Seg = { m: number; kind?: string }            // m: множитель ставки (звёздные колёса) или отношение к цене билета (подарки)
type WheelDef = { id: string; group: 'stars' | 'gifts'; name: string; note: string }
type Built = { segs: Seg[]; price?: number; ev: number; pAbove?: number }
const STAR_TABLES: Record<string, [number, number][]> = { // [множитель, число секторов]
  low: [[0, 5], [0.5, 7], [1, 3], [1.5, 3], [2, 1], [3, 1]],
  mid: [[0, 11], [0.5, 4], [2, 3], [3, 1], [5, 1]],
  high: [[0, 14], [0.5, 2], [2, 2], [3, 1], [8, 1]],
  mega: [[0, 35], [0.5, 4], [30, 1]],
}
const WHEELS: WheelDef[] = [
  { id: 'g1', group: 'gifts', name: 'Классика', note: '12 секторов, обычные подарки' },
  { id: 'g2', group: 'gifts', name: 'Премиум', note: '12 секторов, дорогие подарки' },
  { id: 'g3', group: 'gifts', name: 'NFT', note: '12 секторов, коллекционные подарки' },
  { id: 'g4', group: 'gifts', name: 'Золотое', note: '12 секторов, редкий главный приз' },
]
const GIFT_SPEC: Record<string, { nft: boolean; from: number; quant: number[]; counts: number[] }> = {
  g1: { nft: false, from: 0, quant: [0.05, 0.25, 0.5, 0.75, 1], counts: [4, 3, 2, 2, 1] },
  g2: { nft: false, from: 0.5, quant: [0, 0.3, 0.6, 0.85, 1], counts: [4, 3, 2, 2, 1] },
  g3: { nft: true, from: 0, quant: [0.05, 0.25, 0.5, 0.75, 0.93], counts: [4, 3, 2, 2, 1] },
  g4: { nft: true, from: 0, quant: [0.1, 0.3, 0.55, 0.8, 0.93], counts: [6, 3, 1, 1, 1] },
}
const WHEEL_RTP = 0.8
function spread<T>(items: T[]): T[] { // крупные призы расставлены равномерно и не лежат рядом
  const n = items.length
  let g = Math.round(n * 0.618); const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)
  while (gcd(g, n) !== 1) g++
  const out = new Array<T>(n)
  items.forEach((m, i) => { out[(i * g) % n] = m })
  return out
}
export function buildWheel(id: string): Built | null {
  if (STAR_TABLES[id]) {
    const t = STAR_TABLES[id], list: Seg[] = []
    ;[...t].sort((a, b) => b[0] - a[0]).forEach(([m, c]) => { for (let i = 0; i < c; i++) list.push({ m }) })
    return { segs: spread(list), ev: list.reduce((a, s) => a + s.m, 0) / list.length }
  }
  const sp = GIFT_SPEC[id]; if (!sp) return null
  const all = GIFT_ORDER.filter(k => !!GIFTS[k].nft === sp.nft)
  const pool = all.slice(Math.floor(all.length * sp.from))
  if (pool.length < 6) return null
  const kinds = sp.quant.map(q => pool[Math.min(pool.length - 1, Math.floor(q * (pool.length - 1)))])
  const list: { kind: string; v: number }[] = []
  kinds.forEach((k, i) => { for (let j = 0; j < sp.counts[i]; j++) list.push({ kind: k, v: GIFTS[k].base }) })
  const n = list.length, evSum = list.reduce((a, x) => a + x.v, 0)
  const price = Math.max(10, Math.ceil(evSum / n / WHEEL_RTP))   // цена билета считается из среднего приза: отдача всегда около 80%
  const desc = [...list].sort((a, b) => b.v - a.v)
  const segs = spread(desc).map(x => ({ m: x.v / price, kind: x.kind }))
  return { segs, price, ev: evSum / n / price, pAbove: (list.filter(x => x.v > price).length / n) * 100 }
}
const PAL = ['#3a4a52', '#3b6d8c', '#2e8f7c', '#86c13d', '#e8b73b', '#e0523a', '#c13dd6']
const WCOL: Record<string, string> = { '0': '#26302c', '0.5': '#6f5642', '1': '#3b6d8c', '1.5': '#2e8f7c', '2': '#3db07e', '3': '#86c13d', '5': '#e8b73b', '10': '#f08a2b', '20': '#e0523a', '50': '#c13dd6' }
const polar = (r: number, deg: number) => { const a = ((deg - 90) * Math.PI) / 180; return [100 + r * Math.cos(a), 100 + r * Math.sin(a)] }
function wedgePath(i: number, n: number) {
  const s = 360 / n, [x1, y1] = polar(96, i * s), [x2, y2] = polar(96, (i + 1) * s)
  return `M100 100 L${x1.toFixed(2)} ${y1.toFixed(2)} A96 96 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
}

function WheelPlay({ ctx, rid, onBack }: { ctx: Ctx; rid: string; onBack: () => void }) {
  const W = WHEELS.find(x => x.id === rid)!
  const B = useMemo(() => buildWheel(rid), [rid, GIFT_ORDER.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const segs = B?.segs || []
  const n = segs.length || 1
  const gifts = W.group === 'gifts'
  const colorOf = useMemo(() => { // цвет сектора: по рангу подарка либо по множителю
    if (!gifts) return (s: Seg) => WCOL[String(s.m)] || '#888'
    const ks = [...new Set(segs.map(s => s.kind!))].sort((a, b) => GIFTS[a].base - GIFTS[b].base)
    return (s: Seg) => PAL[Math.min(PAL.length - 1, ks.indexOf(s.kind!))]
  }, [segs, gifts])
  const [stake, setStake] = useState(50)
  const cost = gifts ? B?.price || 0 : stake
  const [spinning, setSpinning] = useState(false)
  const [rot, setRot] = useState(0)
  const [anim, setAnim] = useState(false)
  const [res, setRes] = useState<{ ok: boolean; seg: Seg; text: string } | null>(null)
  const [hist, setHist] = useState<Seg[]>([])
  const el = useRef<SVGGElement>(null)
  const rotRef = useRef(0)
  const timers = useRef<number[]>([])
  const pending = useRef<{ w: number } | null>(null)
  const ctxRef = useRef(ctx); ctxRef.current = ctx
  useEffect(() => () => {
    timers.current.forEach(t => clearTimeout(t))
    const p = pending.current
    if (p) { pending.current = null; if (p.w > 0) ctxRef.current.pay(p.w, 'Колесо удачи — выигрыш') }
  }, [])
  useEffect(() => { // щелчки, когда секторы проходят мимо стрелки
    if (!spinning) return
    let raf = 0, lastIdx = -1, lastT = 0
    const f = (t: number) => {
      const node = el.current
      if (node) {
        const m = new DOMMatrixReadOnly(getComputedStyle(node).transform)
        const ang = ((Math.atan2(m.b, m.a) * 180) / Math.PI + 360) % 360
        const idx = Math.floor((((360 - ang) % 360) / 360) * n)
        if (idx !== lastIdx && t - lastT > 28) { lastIdx = idx; lastT = t; play.tick() }
      }
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [spinning, n])
  const spin = () => {
    if (spinning || !B || !ctx.charge(cost, gifts ? `Колесо подарков «${W.name}»` : 'Колесо удачи — ставка')) return
    ctx.bump('wheel'); setRes(null)
    const idx = rint(n)               // сектор выбран один раз, до анимации
    const seg = segs[idx]
    let w = 0
    if (gifts) { ctx.tally(0, ctx.save.prices[seg.kind!] || GIFTS[seg.kind!].base); ctx.addGift(seg.kind!, 'Колесо подарков') } // подарок выдаётся сразу, анимация только показывает результат
    else { w = Math.floor(stake * seg.m); pending.current = { w } }
    const s = 360 / n
    const c = (idx + 0.5 + (Math.random() - 0.5) * 0.7) * s
    const base = rotRef.current + 6 * 360
    const target = base + ((((-c - base) % 360) + 360) % 360)
    rotRef.current = target
    setSpinning(true); play.spin()
    setAnim(false)
    requestAnimationFrame(() => requestAnimationFrame(() => { setAnim(true); setRot(target) }))
    timers.current.push(window.setTimeout(() => {
      pending.current = null
      setSpinning(false); setHist(h => [seg, ...h].slice(0, 12))
      if (gifts) {
        const v = ctx.save.prices[seg.kind!] || GIFTS[seg.kind!].base
        if (v >= cost * 5) play.jackpot(); else if (v >= cost * 2) play.big(); else if (v >= cost) play.chime(2); else play.chime(1)
        setRes({ ok: v >= cost, seg, text: `${GIFTS[seg.kind!].name} · ≈${cfmt(v)} (билет ${cfmt(cost)})` })
      } else {
        if (w > 0) ctx.pay(w, 'Колесо удачи — выигрыш')
        const m = seg.m
        if (m >= 5) play.jackpot(); else if (m >= 2) play.big(); else if (m >= 1) play.chime(1); else if (m > 0) play.cash(); else { play.thud(); play.lose() }
        setRes({ ok: m >= 1, seg, text: m === 0 ? 'Пусто. Ставка сгорела' : `×${fm(m)} · ${w >= stake ? '+' : ''}${cfmt(w - stake)} (вернулось ${cfmt(w)})` })
      }
    }, 5300))
  }
  // легенда: звёздные колёса по множителю, подарочные по подарку
  const legend = useMemo(() => {
    const map = new Map<string, { seg: Seg; c: number }>()
    segs.forEach(s => { const key = gifts ? s.kind! : String(s.m); const e = map.get(key); if (e) e.c++; else map.set(key, { seg: s, c: 1 }) })
    return [...map.values()].sort((a, b) => b.seg.m - a.seg.m)
  }, [segs, gifts])
  const bigWin = !spinning && res && (gifts ? res.seg.m >= 2 : res.seg.m >= 2)
  return (
    <div className="wheel-game">
      <button className="wheel-back" disabled={spinning} onClick={onBack}>← Все колёса</button>
      <div className="wheel-title"><b>{W.name}</b><span>{W.note}</span></div>
      <div className="chips">{hist.length ? hist.map((h, i) => <span key={i} className="g" style={{ color: colorOf(h), borderColor: colorOf(h) }}>{gifts ? GIFTS[h.kind!].name : `×${fm(h.m)}`}</span>) : <span className="m small">Прошлые результаты появятся здесь</span>}</div>
      <div className={`wheel-box ${spinning ? 'spin' : ''} ${!spinning && res ? (res.ok ? 'win' : 'lose') : ''}`}>
        <svg viewBox="0 0 200 200" className="wheel-svg" role="img" aria-label="Колесо удачи">
          <g ref={el} style={{ transformOrigin: '100px 100px', transform: `rotate(${rot}deg)`, transition: anim ? 'transform 5.2s cubic-bezier(.1,.65,.08,1)' : 'none' }}>
            {segs.map((s, i) => <path key={i} d={wedgePath(i, n)} fill={colorOf(s)} stroke="#10161a" strokeWidth={n > 40 ? 0.15 : 0.6} />)}
            {!gifts && n <= 20 && segs.map((s, i) => { const [x, y] = polar(70, (i + 0.5) * (360 / n)); return <text key={i} x={x} y={y} fill="#fff" fontSize="9" fontWeight="800" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${(i + 0.5) * (360 / n)} ${x} ${y})`}>×{fm(s.m)}</text> })}
            {gifts && segs.map((s, i) => { const ang = (i + 0.5) * (360 / n), [x, y] = polar(66, ang); return <foreignObject key={`g${i}`} x={x - 17} y={y - 17} width={34} height={34} transform={`rotate(${ang} ${x} ${y})`}><div className="wheel-gift"><GiftArt kind={s.kind!} size={30} glow={false} /></div></foreignObject> })}
          </g>
          <circle cx="100" cy="100" r="98" fill="none" stroke="#e9d38a" strokeWidth="3" />
          <HubCap />
          <text x="100" y="101" fill="#e9d38a" fontSize={gifts ? 8 : 10} fontWeight="900" textAnchor="middle" dominantBaseline="middle">{spinning ? '···' : res && !gifts ? `×${fm(res.seg.m)}` : 'КРУТИ'}</text>
        </svg>
        <div className="wheel-ptr" />
        {bigWin && <Burst key={`w${hist.length}`} type={res!.seg.m >= 10 ? 'confetti' : 'gold'} n={res!.seg.m >= 10 ? 200 : res!.seg.m >= 5 ? 110 : 60} />}
      </div>
      {res && gifts && <div className="wheel-prize"><GiftArt kind={res.seg.kind!} size={84} animate /></div>}
      {res && <Result good={res.ok}>{res.text}</Result>}
      {gifts && !B && <p className="m small center">Каталог подарков ещё грузится, зайди через секунду.</p>}
      <div className="wheel-legend">
        {legend.map(({ seg, c }) => <div key={seg.kind || seg.m} className={gifts ? 'gift' : ''}>
          {gifts ? <GiftArt kind={seg.kind!} size={30} glow={false} /> : <i style={{ background: colorOf(seg) }} />}
          <b>{gifts ? GIFTS[seg.kind!].name : `×${fm(seg.m)}`}</b>
          {gifts && <em>{cfmt(GIFTS[seg.kind!].base)}</em>}
          <span>{pct((c / n) * 100)}</span>
        </div>)}
      </div>
      {gifts
        ? null
        : <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={spinning} />}
      <button className="cta" disabled={spinning || !B} onClick={spin}>{spinning ? 'Колесо крутится…' : `Крутить · ${cfmt(cost)}`}</button>
    </div>
  )
}


const WCOL_TAGS: Record<string, string> = { low: '#2e8f7c', mid: '#3b6d8c', high: '#e8b73b', mega: '#c13dd6', g1: '#86c13d', g2: '#e0523a', g3: '#5aa0ff', g4: '#f2b632' }
type WTheme = { cols: string[]; ring: [string, string]; hub: string; glow: string; emblem: 'gift' | 'gem' | 'hex' | 'crown'; studs: number; sep: string }
const WTHEMES: Record<string, WTheme> = {
  g1: { cols: ['#7ccf4a', '#f2994a', '#4fb36b', '#f2c94c'], ring: ['#d9f2a8', '#4b7d1f'], hub: '#1f3a14', glow: '#86c13d', emblem: 'gift', studs: 12, sep: '#173010' },
  g2: { cols: ['#e0523a', '#7a1d2e', '#f08a5d', '#b8324a'], ring: ['#ffe4c2', '#a8472c'], hub: '#3a0f18', glow: '#e0523a', emblem: 'gem', studs: 16, sep: '#2a0a12' },
  g3: { cols: ['#3d7bff', '#17c3e8', '#6a4cff', '#1f9bd6'], ring: ['#bfe6ff', '#2a56b8'], hub: '#0a1a3a', glow: '#5aa0ff', emblem: 'hex', studs: 6, sep: '#08142e' },
  g4: { cols: ['#f2b632', '#fff0b0', '#c98a14', '#ffd86b'], ring: ['#fff6cf', '#8a5a08'], hub: '#3a2606', glow: '#f2b632', emblem: 'crown', studs: 20, sep: '#5a3a06' },
}
function MiniWheel({ id, n = 12 }: { id: string; n?: number }) {
  const t = WTHEMES[id] || WTHEMES.g1
  const R = 84, uid = `mw${id}`
  const ang = (i: number) => (i * 360) / n
  const emblem = t.emblem === 'gift'
    ? <g><rect x="-9" y="-3" width="18" height="13" rx="2" fill="#f2c94c" /><rect x="-9" y="-3" width="18" height="5" rx="2" fill="#ffe27a" /><rect x="-2" y="-3" width="4" height="13" fill="#e0523a" /><path d="M0-3c-7-8-12-1-6 0zM0-3c7-8 12-1 6 0z" fill="#e0523a" /></g>
    : t.emblem === 'gem'
      ? <g><path d="M-9-5h18l6 7-15 13L-15 2z" fill="#4fc3f7" /><path d="M-15 2h30L0 15z" fill="#1e88c9" /><path d="M-9-5h18l6 7h-30z" fill="#9be6ff" /></g>
      : t.emblem === 'hex'
        ? <g><path d="M0-14l12 7v14L0 14l-12-7V-7z" fill="none" stroke="#9fe0ff" strokeWidth="3" /><path d="M0-6l6 3.5v7L0 8l-6-3.5v-7z" fill="#5aa0ff" /></g>
        : <g><path d="M-14 8l-3-16 9 8 8-13 8 13 9-8-3 16z" fill="#ffd34e" stroke="#7a4a00" strokeWidth="2" strokeLinejoin="round" /><circle cx="0" cy="-8" r="2.4" fill="#e0523a" /></g>
  return (
    <svg viewBox="0 0 200 200" className="wm-svg" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}r`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor={t.ring[0]} /><stop offset="1" stopColor={t.ring[1]} /></linearGradient>
        <radialGradient id={`${uid}s`} cx="35%" cy="28%" r="85%"><stop offset="0" stopColor="#fff" stopOpacity=".4" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".3" /></radialGradient>
      </defs>
      <circle cx="100" cy="100" r="98" fill={t.glow} opacity=".22" />
      <circle cx="100" cy="100" r="96" fill={`url(#${uid}r)`} />
      <circle cx="100" cy="100" r="88" fill={t.sep} />
      <g transform="translate(100 100)">
        {Array.from({ length: n }, (_, i) => {
          const a0 = ang(i), a1 = ang(i + 1)
          const [x0, y0] = [Math.sin((a0 * Math.PI) / 180) * R, -Math.cos((a0 * Math.PI) / 180) * R]
          const [x1, y1] = [Math.sin((a1 * Math.PI) / 180) * R, -Math.cos((a1 * Math.PI) / 180) * R]
          const mid = ((a0 + a1) / 2) * (Math.PI / 180), px = Math.sin(mid) * 58, py = -Math.cos(mid) * 58
          return <g key={i}><path d={`M0 0L${x0} ${y0}A${R} ${R} 0 0 1 ${x1} ${y1}Z`} fill={t.cols[i % t.cols.length]} stroke={t.sep} strokeWidth="1.5" /><circle cx={px} cy={py} r="4.2" fill="#fff" opacity=".55" /></g>
        })}
        <circle r={R} fill={`url(#${uid}s)`} />
        {Array.from({ length: t.studs }, (_, i) => { const a = (i * 2 * Math.PI) / t.studs; return <circle key={i} cx={Math.sin(a) * 92} cy={-Math.cos(a) * 92} r="2.6" fill="#fff6c8" opacity=".95" /> })}
        <circle r="25" fill={t.hub} stroke={`url(#${uid}r)`} strokeWidth="5" />
        <g transform="scale(.9)">{emblem}</g>
      </g>
      <path d="M92 2h16l-8 20z" fill="#ffd34e" stroke="#6a3f00" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}
const WHEEL_CATS = ['Все', 'Подарки', 'NFT']
const wheelCat = (id: string) => (id === 'g3' || id === 'g4' ? 'NFT' : 'Подарки')
export function WheelMenu({ onPick, plain }: { onPick: (id: string) => void; plain?: boolean }) {
  const [cat, setCat] = useState('Все')
  const items = useMemo(() => WHEELS.map(w => {
    const B = buildWheel(w.id)
    const gifts = w.group === 'gifts'
    const ks = gifts && B ? [...new Set(B.segs.map(x => x.kind!))].sort((a, b) => GIFTS[b].base - GIFTS[a].base) : []
    const rank = ks.slice().reverse()
    const colorOf = (x: Seg) => (gifts ? PAL[Math.min(PAL.length - 1, rank.indexOf(x.kind!))] : WCOL[String(x.m)] || '#888')
    const top = B ? Math.max(...B.segs.map(x => x.m)) : 0
    return { w, B, gifts, ks, colorOf, top }
  }), [GIFT_ORDER.length]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="wheel-menu">
      <div className="case-cats" role="tablist">
        {WHEEL_CATS.map(c => <button key={c} role="tab" aria-selected={cat === c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}<small>{c === 'Все' ? WHEELS.length : WHEELS.filter(w => wheelCat(w.id) === c).length}</small></button>)}
      </div>
      <div className="wm-grid">
        {items.filter(x => cat === 'Все' || wheelCat(x.w.id) === cat).map(({ w, B, gifts, ks, colorOf, top }) => (
          <button key={w.id} className="wm-card" disabled={!B} style={{ ['--wc' as string]: WCOL_TAGS[w.id] }} onClick={() => { onPick(w.id); play.click() }}>
            <div className="wm-pic">{B && <MiniWheel id={w.id} n={B.segs.length} />}</div>
            <b>{w.name}</b>
            <span className="wm-note">{w.note}</span>
            <span className="wm-price">{gifts ? (B?.price ? `Билет ${cfmt(B.price)}` : '—') : 'Любая ставка'}</span>
            {gifts
              ? <div className="wm-gifts">{ks.slice(0, 5).map(k => <GiftArt key={k} kind={k} size={26} glow={false} />)}</div>
              : <span className="wm-top">до ×{fm(top)}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
export function Wheel({ ctx, seed }: { ctx: Ctx; seed?: string | null }) {
  const [rid, setRid] = useState<string | null>(seed && WHEELS.some(w => w.id === seed) ? seed : null)
  if (rid) return <WheelPlay ctx={ctx} rid={rid} onBack={() => setRid(null)} />
  return <WheelMenu onPick={setRid} />
}

// ============================== СКРЕТЧ-КАРТЫ ==============================
type Prize = { m: number; p: number; sym: IconName }
type Tier = { id: string; name: string; price: number; hue: number; note: string; prizes: Prize[] }
const TIERS: Tier[] = [
  { id: 'bronze', name: 'Бронза', price: 20, hue: 28, note: 'Часто и понемногу', prizes: [{ m: 1.5, p: 0.2, sym: 'cherry' }, { m: 2, p: 0.1, sym: 'lemon' }, { m: 5, p: 0.04, sym: 'bell' }, { m: 10, p: 0.01, sym: 'gem' }] },
  { id: 'silver', name: 'Серебро', price: 100, hue: 200, note: 'Золотая середина', prizes: [{ m: 1.5, p: 0.03, sym: 'cherry' }, { m: 2, p: 0.15, sym: 'lemon' }, { m: 5, p: 0.05, sym: 'bell' }, { m: 10, p: 0.01, sym: 'gem' }, { m: 50, p: 0.002, sym: 'crown' }] },
  { id: 'gold', name: 'Золото', price: 500, hue: 46, note: 'Реже, но крупнее', prizes: [{ m: 2, p: 0.1, sym: 'lemon' }, { m: 3, p: 0.007, sym: 'clover' }, { m: 5, p: 0.06, sym: 'bell' }, { m: 20, p: 0.008, sym: 'gem' }, { m: 100, p: 0.0012, sym: 'crown' }] },
  { id: 'dia', name: 'Алмаз', price: 2500, hue: 280, note: 'Редко и очень крупно', prizes: [{ m: 3, p: 0.08, sym: 'clover' }, { m: 10, p: 0.02, sym: 'gem' }, { m: 50, p: 0.004, sym: 'crown' }, { m: 250, p: 0.00064, sym: 'rocket' }] },
]
export const tierRtp = (t: Tier) => t.prizes.reduce((a, x) => a + x.m * x.p, 0)

export function Scratch({ ctx }: { ctx: Ctx }) {
  const [tid, setTid] = useState('silver')
  const T = TIERS.find(x => x.id === tid)!
  const gifts = useMemo(() => GIFT_ORDER.filter(k => GIFTS[k] && !GIFTS[k].nft && !GIFTS[k].retired).sort((a, b) => GIFTS[a].base - GIFTS[b].base), [GIFT_ORDER.length]) // eslint-disable-line react-hooks/exhaustive-deps
  // чем крупнее выигрыш, тем дороже подарок на карте
  const symFor = (t: Tier, m: number): string => {
    const asc = [...t.prizes].sort((a, b) => a.m - b.m), r = asc.findIndex(x => x.m === m)
    return gifts[Math.min(gifts.length - 1, Math.floor(((r + 0.5) / asc.length) * gifts.length))] || ''
  }
  const [card, setCard] = useState<{ syms: string[]; m: number; id: number; tier: string } | null>(null)
  const [done, setDone] = useState(false)
  const [res, setRes] = useState<{ ok: boolean; text: string; m: number } | null>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const lastPt = useRef<[number, number] | null>(null)
  const moves = useRef(0)
  const pending = useRef<{ w: number } | null>(null)
  const cardRef = useRef(card); cardRef.current = card
  const ctxRef = useRef(ctx); ctxRef.current = ctx
  useEffect(() => () => {
    const p = pending.current
    if (p) { pending.current = null; if (p.w > 0) ctxRef.current.pay(p.w, 'Скретч-карта — выигрыш') }
  }, [])
  const buy = () => {
    if (card && !done) return
    if (!gifts.length) { ctx.notify('Каталог подарков ещё грузится'); return }
    if (!ctx.charge(T.price, `Скретч-карта «${T.name}»`)) return
    ctx.bump('scratch')
    // Итог карты выбирается один раз при покупке по таблице шансов
    let r = Math.random(), m = 0, sym = ''
    for (const pz of T.prizes) { if (r < pz.p) { m = pz.m; sym = symFor(T, pz.m); break } r -= pz.p }
    let syms: string[]
    if (m > 0) syms = [sym, sym, sym]
    else {
      const pool = [...new Set([...T.prizes.map(x => symFor(T, x.m)), ...gifts])]
      do { syms = [0, 1, 2].map(() => pool[rint(pool.length)]) } while (syms[0] === syms[1] && syms[1] === syms[2])
      if (Math.random() < 0.35) { const k = rint(3); const o = rint(2); const j = [0, 1, 2].filter(x => x !== k)[o]; syms[j] = syms[k]; if (syms[0] === syms[1] && syms[1] === syms[2]) syms[j] = pool.find(x => x !== syms[k]) || gifts[0] }
    }
    pending.current = { w: Math.floor(T.price * m) }
    setCard({ syms, m, id: Date.now(), tier: T.id }); setDone(false); setRes(null); play.card()
  }
  useEffect(() => { // нанести защитный слой
    const c = cv.current; if (!c || !card) return
    const dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight
    c.width = w * dpr; c.height = h * dpr
    const g = c.getContext('2d')!; g.scale(dpr, dpr)
    const grad = g.createLinearGradient(0, 0, w, h)
    grad.addColorStop(0, '#c9ced1'); grad.addColorStop(0.5, '#eef1f2'); grad.addColorStop(1, '#a9b0b4')
    g.fillStyle = grad; g.fillRect(0, 0, w, h)
    g.globalAlpha = 0.18; g.fillStyle = '#fff'
    for (let i = 0; i < 260; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2)
    g.globalAlpha = 0.5; g.fillStyle = '#6b7478'; g.font = '800 15px system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText('СОТРИ ЗАЩИТНЫЙ СЛОЙ', w / 2, h / 2 - 8)
    g.globalAlpha = 0.5; g.font = '800 12px system-ui,sans-serif'; g.fillText('QcUp', w / 2, h / 2 + 10)
    g.globalAlpha = 1
  }, [card?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const finish = () => {
    const cd = cardRef.current; if (!cd || !pending.current) return
    const w = pending.current.w; pending.current = null
    const t = TIERS.find(x => x.id === cd.tier)!
    const c = cv.current
    if (c) c.style.opacity = '0'
    setDone(true)
    if (w > 0) {
      ctx.pay(w, 'Скретч-карта — выигрыш')
      if (cd.m >= 50) play.jackpot(); else if (cd.m >= 5) play.big(); else play.chime(2)
      setRes({ ok: true, m: cd.m, text: `Три одинаковых! ×${fm(cd.m)} · +${cfmt(w - t.price)} (вернулось ${cfmt(w)})` })
    } else { play.thud(); play.lose(); setRes({ ok: false, m: 0, text: 'Совпадений нет. Карта сгорела' }) }
  }
  const coverage = () => {
    const c = cv.current; if (!c) return 0
    const g = c.getContext('2d')!, d = g.getImageData(0, 0, c.width, c.height).data
    let clear = 0, all = 0
    for (let i = 3; i < d.length; i += 64) { all++; if (d[i] < 40) clear++ }
    return clear / Math.max(1, all)
  }
  const pt = (e: React.PointerEvent<HTMLCanvasElement>): [number, number] => { const r = e.currentTarget.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  const erase = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || done) return
    const c = cv.current!, g = c.getContext('2d')!, [x, y] = pt(e), dpr = window.devicePixelRatio || 1
    g.save(); g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.globalCompositeOperation = 'destination-out'; g.lineCap = 'round'; g.lineJoin = 'round'; g.lineWidth = 34
    g.beginPath(); const l = lastPt.current || [x, y]; g.moveTo(l[0], l[1]); g.lineTo(x + 0.01, y); g.stroke(); g.restore()
    lastPt.current = [x, y]
    if (++moves.current % 3 === 0) play.scratch()
    if (moves.current % 8 === 0 && coverage() > 0.55) finish()
  }
  const t = T
  const win = res?.ok
  return (
    <div className="scratch-game">
      <div className="tier-row">
        {TIERS.map(x => <button key={x.id} className={`tier ${tid === x.id ? 'on' : ''}`} disabled={!!card && !done} style={{ ['--th' as string]: x.hue }} onClick={() => { setTid(x.id); play.click() }}>
          <b>{x.name}</b><span>{cfmt(x.price)}</span>
        </button>)}
      </div>
      <div className={`scratch-card ${win === true ? 'win' : win === false ? 'lose' : ''}`} style={{ ['--th' as string]: t.hue }}>
        <div className="sc-head"><b>{t.name}</b><span>{card ? 'Найди три одинаковых символа' : t.note}</span></div>
        <div className="sc-field">
          <div className="sc-syms">{(card ? card.syms : [null, null, null]).map((s, i) => <div key={i} className={card && done && card.m > 0 ? 'hit' : ''}>{s ? <GiftArt kind={s} size={96} glow={false} /> : <span className="q">?</span>}</div>)}</div>
          {card && <canvas key={card.id} ref={cv} className="sc-coat" onPointerDown={e => { drawing.current = true; lastPt.current = pt(e); e.currentTarget.setPointerCapture(e.pointerId); erase(e) }} onPointerMove={erase} onPointerUp={() => { drawing.current = false; lastPt.current = null }} onPointerCancel={() => { drawing.current = false }} />}
        </div>
        {done && res?.ok && <Burst key={card!.id} type={res.m >= 50 ? 'confetti' : 'gold'} n={res.m >= 50 ? 200 : res.m >= 5 ? 110 : 60} />}
      </div>
      {res && <Result good={res.ok}>{res.text}</Result>}
      {card && !done && <button className="cta ghost" onClick={finish}>Стереть всё</button>}
      <button className="cta" disabled={(!!card && !done) || ctx.save.balance < t.price} onClick={buy}>{card && !done ? 'Сотри слой…' : card ? `Ещё карту · ${cfmt(t.price)}` : `Купить карту · ${cfmt(t.price)}`}</button>
      <h3 className="sub-title">Что можно выиграть · {t.name}</h3>
      <div className="sc-table">
        {[...t.prizes].sort((a, b) => b.m - a.m).map(p => <div key={p.m}><span className="sy"><GiftArt kind={symFor(t, p.m)} size={22} glow={false} /><GiftArt kind={symFor(t, p.m)} size={22} glow={false} /><GiftArt kind={symFor(t, p.m)} size={22} glow={false} /></span><b>×{fm(p.m)}</b><em>{cfmt(Math.floor(t.price * p.m))}</em><i>{pct(p.p * 100)}</i></div>)}
      </div>
      <p className="m small center">Выигрыш определён в момент покупки, стирание его не меняет. Три одинаковых символа выигрывают, два совпавших ничего не дают.</p>
    </div>
  )
}

// ============================== БАШНЯ ==============================
type Diff = { id: string; name: string; tiles: number; traps: number; floors: number }
const DIFFS: Diff[] = [
  { id: 'easy', name: 'Лёгкая', tiles: 4, traps: 1, floors: 8 },
  { id: 'mid', name: 'Средняя', tiles: 3, traps: 1, floors: 8 },
  { id: 'hard', name: 'Сложная', tiles: 2, traps: 1, floors: 8 },
  { id: 'hc', name: 'Хардкор', tiles: 3, traps: 2, floors: 6 },
]
const towerMult = (d: Diff, k: number) => (k <= 0 ? 1 : Math.floor((RTP / Math.pow((d.tiles - d.traps) / d.tiles, k)) * 100) / 100)

export function Tower({ ctx }: { ctx: Ctx }) {
  const [did, setDid] = useState('mid')
  const D = DIFFS.find(x => x.id === did)!
  const [stake, setStake] = useState(50)
  const [run, setRun] = useState<{ d: Diff; stake: number; traps: number[][]; picks: number[]; over: 'none' | 'lost' | 'cash'; lost?: number } | null>(null)
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null)
  const runRef = useRef(run); runRef.current = run
  const ctxRef = useRef(ctx); ctxRef.current = ctx
  useEffect(() => () => { // вышел с экрана посреди игры: забираем то, что набрано (или возвращаем ставку, если ни одного этажа)
    const r = runRef.current
    if (r && r.over === 'none') ctxRef.current.pay(r.picks.length ? Math.floor(r.stake * towerMult(r.d, r.picks.length)) : r.stake, 'Башня — выход из игры')
  }, [])
  const active = !!run && run.over === 'none'
  const floor = run ? run.picks.length : 0
  const cur = run ? run.d : D
  const start = () => {
    if (active || !ctx.charge(stake, 'Башня — ставка')) return
    ctx.bump('tower'); play.door()
    const traps = Array.from({ length: D.floors }, () => { const s = new Set<number>(); while (s.size < D.traps) s.add(rint(D.tiles)); return [...s] })
    setRun({ d: D, stake, traps, picks: [], over: 'none' }); setRes(null)
  }
  const pick = (t: number) => {
    if (!run || run.over !== 'none') return
    const f = run.picks.length
    if (run.traps[f].includes(t)) {
      setRun({ ...run, picks: [...run.picks, t], over: 'lost', lost: f })
      play.boom(); play.lose(); setRes({ ok: false, text: `Ловушка на ${f + 1}-м этаже. Ставка сгорела` })
      return
    }
    const picks = [...run.picks, t]
    play.step(); play.ding(picks.length)
    if (picks.length >= run.d.floors) {
      const w = Math.floor(run.stake * towerMult(run.d, picks.length))
      setRun({ ...run, picks, over: 'cash' }); ctx.pay(w, 'Башня — вершина'); play.jackpot()
      setRes({ ok: true, text: `Вершина! ×${fm(towerMult(run.d, picks.length))} · +${cfmt(w - run.stake)}` })
    } else setRun({ ...run, picks })
  }
  const cash = () => {
    if (!run || run.over !== 'none' || !run.picks.length) return
    const k = run.picks.length, w = Math.floor(run.stake * towerMult(run.d, k))
    setRun({ ...run, over: 'cash' }); ctx.pay(w, 'Башня — выигрыш'); play.cash(); play.chime(k >= 5 ? 2 : 1)
    setRes({ ok: true, text: `Забрал на ${k}-м этаже: ×${fm(towerMult(run.d, k))} · +${cfmt(w - run.stake)}` })
  }
  const nextMult = towerMult(cur, floor + 1)
  const nowMult = towerMult(cur, floor)
  const rows = Array.from({ length: cur.floors }, (_, i) => cur.floors - 1 - i) // сверху вершина
  return (
    <div className="tower-game">
      <div className="hl-info"><div><small>Этаж</small><b>{floor}/{cur.floors}</b></div><div><small>Сейчас</small><b>{run ? `×${fm(nowMult)}` : '—'}</b></div><div><small>Следующий</small><b>×{fm(nextMult)}</b></div></div>
      <div className={`tower ${run?.over === 'lost' ? 'tw-lost' : ''} ${run?.over === 'cash' ? 'tw-won' : ''}`}>
        
        {rows.map(f => {
          const isCur = active && f === floor
          const passed = !!run && f < floor && !(run.over === 'lost' && f === run.lost)
          const isLost = run?.over === 'lost' && f === run.lost
          const reveal = !!run && run.over !== 'none'
          return (
            <div key={f} className={`t-row ${isCur ? 't-cur' : ''} ${passed ? 't-passed' : ''} ${isLost ? 't-lostrow' : ''} ${!run || f > floor ? 't-locked' : ''}`} style={{ ['--tn' as string]: cur.tiles }}>
              <span className="t-mult">×{fm(towerMult(cur, f + 1))}</span>
              {Array.from({ length: cur.tiles }, (_, t) => {
                const trap = !!run && run.traps[f]?.includes(t)
                const picked = !!run && run.picks[f] === t
                const showTrap = reveal && trap && f < run!.picks.length // бомбы видны только на пройденных этажах и на том, где случилась ловушка
                return <button key={t} disabled={!isCur} onClick={() => pick(t)}
                  className={`t-tile ${picked ? (trap ? 'tt-boom' : 'tt-ok') : ''} ${showTrap && !picked ? 'tt-trap' : ''}`}>
                  {picked ? <Icon name={trap ? 'blast' : 'gem'} size={26} /> : showTrap ? <Icon name="bomb" size={24} /> : null}
                </button>
              })}
            </div>
          )
        })}
        {run?.over === 'cash' && <Burst key={`t${run.picks.length}`} type={run.picks.length >= run.d.floors ? 'confetti' : 'gold'} n={run.picks.length >= run.d.floors ? 200 : 80} />}
      </div>
      {res && <Result good={res.ok}>{res.text}</Result>}
      <div className="hl-modes four">{DIFFS.map(x => <button key={x.id} className={(run ? run.d.id : did) === x.id ? 'on' : ''} disabled={active} onClick={() => { setDid(x.id); play.click() }}>{x.name}</button>)}</div>
      <p className="m small center">{cur.tiles} плитки на этаже, ловушек: {cur.traps} · шанс пройти этаж {pct(((cur.tiles - cur.traps) / cur.tiles) * 100)} · этажей: {cur.floors}</p>
      {!active && <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} />}
      {active
        ? <button className="cta" disabled={!floor} onClick={cash}>{floor ? `Забрать ${cfmt(Math.floor(run!.stake * nowMult))} (×${fm(nowMult)})` : 'Выбери плитку на нижнем этаже'}</button>
        : <button className="cta" disabled={ctx.save.balance < 1} onClick={start}>{run ? 'Новая игра' : 'Начать'} · {cfmt(stake)}</button>}
    </div>
  )
}
