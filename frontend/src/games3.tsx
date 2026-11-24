import { useEffect, useMemo, useRef, useState } from 'react'
import { Burst } from './fx'
import { play } from './sfx'
import { rint, money, cfmt } from './lib'
import { Result, StakeInput } from './games'
import type { Ctx } from './games'

// Честные шансы: результат выбирается один раз до анимации, коэффициенты считаются из реальных вероятностей
// (отдача 84%, округление вниз до сотых). Выигрыш выдаётся, даже если игрок ушёл с экрана.
const RTP = 0.84
const KENO_RTP = 0.72 // Кено щедрее других игр по частоте выигрышей, поэтому отдача ниже
const fm = (v: number) => (Math.round(v * 100) / 100).toString().replace('.', ',')
const pct = (p: number) => (p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p >= 0.1 ? p.toFixed(2) : p >= 0.01 ? p.toFixed(3) : p.toFixed(4)).replace('.', ',') + '%'

// ============================== КЕНО ==============================
// 40 чисел, выпадает 10. Игрок выбирает от 1 до 10 чисел. Вероятность k совпадений: C(10,k)·C(30,n-k) / C(40,n).
const choose = (n: number, k: number) => { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r }
const kenoP = (n: number, k: number) => (choose(10, k) * choose(30, n - k)) / choose(40, n)
// плавное сжатие больших иксов: до ×30 без изменений, дальше растут всё медленнее и никогда не превышают ×230
const softCap = (m: number) => (m <= 30 ? m : 30 + 200 * (1 - Math.exp(-(m - 30) / 200)))
export function kenoTable(n: number): { k: number; p: number; m: number }[] {
  for (let kmin = [1, 2, 2, 3, 3, 3, 4, 4, 4, 5][n - 1]; kmin <= n; kmin++) {
    const ks = Array.from({ length: n - kmin + 1 }, (_, i) => kmin + i)
    const wt = ks.map(k => Math.pow(kenoP(n, k), 0.35)), sw = wt.reduce((a, b) => a + b, 0)
    const rows = ks.map((k, i) => { const p = kenoP(n, k); return { k, p, m: Math.floor(softCap((KENO_RTP * wt[i]) / sw / p) * 100) / 100 } })
    if (rows[0].m >= 1 || kmin === n) return rows
  }
  return []
}
export const kenoRtp = (n: number) => kenoTable(n).reduce((a, r) => a + r.p * r.m, 0)

export function Keno({ ctx }: { ctx: Ctx }) {
  const [picked, setPicked] = useState<number[]>([])
  const [drawn, setDrawn] = useState<number[]>([])
  const [shown, setShown] = useState(0)          // сколько шаров уже показано
  const [stake, setStake] = useState(50)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ ok: boolean; text: string; hits: number } | null>(null)
  const timers = useRef<number[]>([])
  const pending = useRef<{ w: number } | null>(null)
  const ctxRef = useRef(ctx); ctxRef.current = ctx
  useEffect(() => () => {
    timers.current.forEach(t => clearTimeout(t))
    const p = pending.current
    if (p) { pending.current = null; if (p.w > 0) ctxRef.current.pay(p.w, 'Кено — выигрыш') }
  }, [])
  const n = picked.length
  const table = useMemo(() => (n ? kenoTable(n) : []), [n])
  const toggle = (v: number) => {
    if (busy) return
    if (drawn.length) { setDrawn([]); setShown(0); setRes(null) }
    if (picked.includes(v)) { setPicked(picked.filter(x => x !== v)); play.tick() }
    else if (picked.length >= 10) ctx.notify('Можно выбрать не больше 10 чисел')
    else { setPicked([...picked, v]); play.ding(picked.length) }
  }
  const auto = (k: number) => {
    if (busy) return
    const s = new Set<number>(); while (s.size < k) s.add(1 + rint(40))
    setPicked([...s]); setDrawn([]); setShown(0); setRes(null); play.click()
  }
  const go = () => {
    if (busy || !n || !ctx.charge(stake, 'Кено — ставка')) return
    ctx.bump('keno'); play.click()
    const s = new Set<number>(); while (s.size < 10) s.add(1 + rint(40)) // 10 шаров выбраны сразу, до анимации
    const d = [...s]
    const hits = d.filter(x => picked.includes(x)).length
    const row = table.find(r => r.k === hits)
    const w = row ? Math.floor(stake * row.m) : 0
    pending.current = { w }
    setBusy(true); setDrawn(d); setShown(0); setRes(null)
    d.forEach((x, i) => timers.current.push(window.setTimeout(() => { setShown(i + 1); if (picked.includes(x)) play.ding(i); else play.bounce(i) }, 350 + i * 280)))
    timers.current.push(window.setTimeout(() => {
      pending.current = null; setBusy(false)
      if (w > 0) {
        ctx.pay(w, 'Кено — выигрыш')
        const m = row!.m
        if (m >= 20) play.jackpot(); else if (m >= 4) play.big(); else play.chime(1)
        setRes({ ok: true, hits, text: `Совпало ${hits} из ${n}. ×${fm(m)} · +${cfmt(w - stake)}` })
      } else { play.thud(); play.lose(); setRes({ ok: false, hits, text: `Совпало ${hits} из ${n}. Ставка сгорела` }) }
    }, 350 + 10 * 280 + 300))
  }
  const done = !busy && res
  const best = n ? table[table.length - 1] : null
  const live = drawn.slice(0, shown).filter(x => picked.includes(x)).length // совпадения по ходу розыгрыша
  const hasDraw = drawn.length > 0
  return (
    <div className="keno-game">
      <div className={`keno-machine ${busy ? 'run' : ''} ${done ? (res!.ok ? 'win' : 'lose') : ''}`}>
        <div className="km-top"><span className="km-title">КЕНО</span>
          <span className="km-cnt">Выбрано <b>{n}</b>/10</span>
          <span className="km-cnt">Совпало <b className={live ? 'g' : ''}>{hasDraw ? live : '–'}</b></span></div>
        <div className="km-balls">
          {Array.from({ length: 10 }, (_, i) => {
            const v = drawn[i], on = i < shown && v !== undefined
            return <div key={i} className="km-slot"><b key={on ? `s${v}` : `e${i}`} className={on ? (picked.includes(v) ? 'hit' : 'miss') : ''}>{on ? v : ''}</b></div>
          })}
        </div>
        {done && res!.ok && <Burst key={`k${drawn.join('')}`} type={best && res!.hits === best.k ? 'confetti' : 'gold'} n={res!.hits >= n ? 180 : 70} />}
      </div>
      {res && <Result good={res.ok}>{res.text}</Result>}
      <div className="keno-grid">
        {Array.from({ length: 40 }, (_, i) => i + 1).map(v => {
          const isPick = picked.includes(v), isDrawn = drawn.slice(0, shown).includes(v)
          return <button key={v} disabled={busy} className={`${isPick ? 'pick' : ''} ${isDrawn ? (isPick ? 'hit' : 'drawn') : ''}`} onClick={() => toggle(v)}><span>{v}</span></button>
        })}
      </div>
      <div className="keno-quick">
        {[3, 5, 8, 10].map(k => <button key={k} disabled={busy} onClick={() => auto(k)}>Случайно {k}</button>)}
        <button className="clr" disabled={busy || !n} onClick={() => { setPicked([]); setDrawn([]); setShown(0); setRes(null); play.click() }}>Сброс</button>
      </div>
      <div className="keno-pay">
        <div className="kp-title">Таблица выплат{n ? ` · ${n} из 40` : ''}</div>
        {n === 0 && <p className="m small center">Выбери от 1 до 10 чисел, и здесь появится таблица выплат.</p>}
        {table.map(r => <div key={r.k} className={`kp-row ${hasDraw && live >= r.k ? 'reach' : ''} ${done && res!.hits === r.k ? 'now' : ''}`}>
          <em>{r.k}</em><span className="kp-m">×{fm(r.m)}</span><span className="kp-w">{cfmt(Math.floor(stake * r.m))}</span><i>{pct(r.p * 100)}</i>
        </div>)}
      </div>
      <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={busy} />
      <button className="cta" disabled={busy || !n} onClick={go}>{busy ? 'Шары выпадают…' : n ? `Играть · ${cfmt(stake)}` : 'Выбери числа'}</button>
      <p className="m small center">Из 40 чисел выпадает 10. Чем больше чисел выбрано, тем больше совпадений нужно для выигрыша.</p>
    </div>
  )
}

// ============================== РУЛЕТКА ==============================
const ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26]
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36])
const colorOf = (n: number) => (n === 0 ? 'green' : REDS.has(n) ? 'red' : 'black')
type BetDef = { id: string; label: string; wins: (n: number) => boolean; cover: number }
const outside: BetDef[] = [
  { id: 'red', label: 'Красное', wins: n => n > 0 && REDS.has(n), cover: 18 },
  { id: 'black', label: 'Чёрное', wins: n => n > 0 && !REDS.has(n), cover: 18 },
  { id: 'even', label: 'Чёт', wins: n => n > 0 && n % 2 === 0, cover: 18 },
  { id: 'odd', label: 'Нечёт', wins: n => n % 2 === 1, cover: 18 },
  { id: 'low', label: '1–18', wins: n => n >= 1 && n <= 18, cover: 18 },
  { id: 'high', label: '19–36', wins: n => n >= 19, cover: 18 },
  { id: 'd1', label: '1–12', wins: n => n >= 1 && n <= 12, cover: 12 },
  { id: 'd2', label: '13–24', wins: n => n >= 13 && n <= 24, cover: 12 },
  { id: 'd3', label: '25–36', wins: n => n >= 25, cover: 12 },
]
const straight = (v: number): BetDef => ({ id: `n${v}`, label: String(v), wins: n => n === v, cover: 1 })
const betMult = (cover: number) => Math.floor(((RTP * 37) / cover) * 100) / 100 // отдача одинакова для любой ставки
const polar = (r: number, deg: number) => { const a = ((deg - 90) * Math.PI) / 180; return [100 + r * Math.cos(a), 100 + r * Math.sin(a)] }
const CHIPS = [10, 50, 100, 500]

export function Roulette({ ctx }: { ctx: Ctx }) {
  const [chip, setChip] = useState(50)
  const [bets, setBets] = useState<Record<string, number>>({})
  const [rot, setRot] = useState(0)
  const [anim, setAnim] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const [num, setNum] = useState<number | null>(null)
  const [hist, setHist] = useState<number[]>([])
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null)
  const el = useRef<SVGGElement>(null)
  const rotRef = useRef(0)
  const timers = useRef<number[]>([])
  const pending = useRef<{ w: number } | null>(null)
  const ctxRef = useRef(ctx); ctxRef.current = ctx
  useEffect(() => () => {
    timers.current.forEach(t => clearTimeout(t))
    const p = pending.current
    if (p) { pending.current = null; if (p.w > 0) ctxRef.current.pay(p.w, 'Рулетка — выигрыш') }
  }, [])
  useEffect(() => {
    if (!spinning) return
    let raf = 0, lastIdx = -1, lastT = 0
    const f = (t: number) => {
      const node = el.current
      if (node) {
        const m = new DOMMatrixReadOnly(getComputedStyle(node).transform)
        const ang = ((Math.atan2(m.b, m.a) * 180) / Math.PI + 360) % 360
        const idx = Math.floor((((360 - ang) % 360) / 360) * 37)
        if (idx !== lastIdx && t - lastT > 30) { lastIdx = idx; lastT = t; play.tick() }
      }
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [spinning])
  const allDefs = useMemo(() => { const m = new Map<string, BetDef>(); outside.forEach(b => m.set(b.id, b)); for (let i = 0; i <= 36; i++) m.set(`n${i}`, straight(i)); return m }, [])
  const total = Object.values(bets).reduce((a, b) => a + b, 0)
  const addBet = (id: string) => { if (spinning) return; setBets(b => ({ ...b, [id]: (b[id] || 0) + chip })); setRes(null); play.click() }
  const spin = () => {
    if (spinning || !total || !ctx.charge(total, 'Рулетка — ставки')) return
    ctx.bump('roulette'); setRes(null)
    const idx = rint(37), n = ORDER[idx]            // число выбрано один раз, до анимации
    let w = 0
    for (const [id, amount] of Object.entries(bets)) { const d = allDefs.get(id)!; if (d.wins(n)) w += Math.floor(amount * betMult(d.cover)) }
    pending.current = { w }
    const s = 360 / 37, c = (idx + 0.5 + (Math.random() - 0.5) * 0.6) * s
    const base = rotRef.current + 7 * 360
    const target = base + ((((-c - base) % 360) + 360) % 360)
    rotRef.current = target
    setSpinning(true); setNum(null); play.spin(); setAnim(false)
    requestAnimationFrame(() => requestAnimationFrame(() => { setAnim(true); setRot(target) }))
    timers.current.push(window.setTimeout(() => {
      pending.current = null; setSpinning(false); setNum(n); setHist(h => [n, ...h].slice(0, 14))
      if (w > 0) {
        ctx.pay(w, 'Рулетка — выигрыш')
        if (w >= total * 10) play.jackpot(); else if (w >= total * 2) play.big(); else play.chime(1)
        setRes({ ok: w > total, text: `Выпало ${n}. Выплата ${cfmt(w)} (${w >= total ? '+' : ''}${cfmt(w - total)})` })
      } else { play.thud(); play.lose(); setRes({ ok: false, text: `Выпало ${n}. Ставки сгорели` }) }
    }, 5600))
  }
  const cell = (id: string, label: string, cls = '') => (
    <button key={id} className={`rl-cell ${cls} ${bets[id] ? 'has' : ''} ${num !== null && !spinning && allDefs.get(id)!.wins(num) ? 'won' : ''}`} disabled={spinning} onClick={() => addBet(id)}>
      {label}{bets[id] ? <em>{bets[id] >= 1000 ? `${(bets[id] / 1000).toFixed(bets[id] % 1000 ? 1 : 0)}k` : bets[id]}</em> : null}
    </button>
  )
  return (
    <div className="rl-game">
      <div className="chips">{hist.length ? hist.map((h, i) => <span key={i} className={`g rl-${colorOf(h)}`}>{h}</span>) : <span className="m small">Прошлые числа появятся здесь</span>}</div>
      <div className={`wheel-box rl-wheel ${spinning ? 'spin' : ''}`}>
        <svg viewBox="0 0 200 200" className="wheel-svg" role="img" aria-label="Рулетка">
          <g ref={el} style={{ transformOrigin: '100px 100px', transform: `rotate(${rot}deg)`, transition: anim ? 'transform 5.4s cubic-bezier(.1,.65,.08,1)' : 'none' }}>
            {ORDER.map((v, i) => {
              const s = 360 / 37, [x1, y1] = polar(96, i * s), [x2, y2] = polar(96, (i + 1) * s), [tx, ty] = polar(82, (i + 0.5) * s)
              return <g key={v}><path d={`M100 100L${x1.toFixed(2)} ${y1.toFixed(2)}A96 96 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}Z`} fill={colorOf(v) === 'red' ? '#c0322c' : colorOf(v) === 'black' ? '#1b1f22' : '#1e8a52'} stroke="#e9d38a" strokeWidth="0.4" />
                <text x={tx} y={ty} fill="#fff" fontSize="6.4" fontWeight="800" textAnchor="middle" dominantBaseline="middle" transform={`rotate(${(i + 0.5) * s} ${tx} ${ty})`}>{v}</text></g>
            })}
          </g>
          <circle cx="100" cy="100" r="98" fill="none" stroke="#e9d38a" strokeWidth="3" />
          <circle cx="100" cy="100" r="52" fill="#10161a" stroke="#e9d38a" strokeWidth="2.5" />
          <text x="100" y="101" className={`rl-center rl-${num === null ? 'none' : colorOf(num)}`} fontSize="30" fontWeight="900" textAnchor="middle" dominantBaseline="middle" fill="#e9d38a">{spinning ? '···' : num === null ? '?' : num}</text>
        </svg>
        <div className="wheel-ptr" />
        {!spinning && res?.ok && <Burst key={`r${hist.length}`} type={res && num !== null && bets[`n${num}`] ? 'confetti' : 'gold'} n={num !== null && bets[`n${num}`] ? 200 : 80} />}
      </div>
      {res && <Result good={res.ok}>{res.text}</Result>}
      <div className="rl-board">
        <div className="rl-zero">{cell('n0', '0', 'green')}</div>
        <div className="rl-nums">{Array.from({ length: 36 }, (_, i) => i + 1).map(v => cell(`n${v}`, String(v), colorOf(v)))}</div>
        <div className="rl-out">{outside.map(b => cell(b.id, b.label, 'out'))}</div>
      </div>
      <div className="rl-info">
        <span>Фишка</span>
        {CHIPS.map(c => <button key={c} className={chip === c ? 'on' : ''} disabled={spinning} onClick={() => { setChip(c); play.click() }}>{c}</button>)}
        <button disabled={spinning || !total} onClick={() => { setBets({}); play.click() }}>Сбросить</button>
      </div>
      <div className="hl-info"><div><small>Число: ×{fm(betMult(1))}</small><b>1/37</b></div><div><small>Цвет, чёт: ×{fm(betMult(18))}</small><b>18/37</b></div><div><small>Дюжина: ×{fm(betMult(12))}</small><b>12/37</b></div></div>
      <button className="cta" disabled={spinning || !total || ctx.save.balance < total} onClick={spin}>{spinning ? 'Колесо крутится…' : total ? `Крутить · ${cfmt(total)}` : 'Поставь фишки на стол'}</button>
      <StakeInput value={chip} onChange={v => setChip(v)} balance={ctx.save.balance} disabled={spinning} />
      <p className="m small center">37 чисел (0–36), все равновероятны. Можно ставить на несколько полей сразу, итоговая ставка равна сумме фишек.</p>
    </div>
  )
}
