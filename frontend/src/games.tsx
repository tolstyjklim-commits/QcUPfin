import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { GiftArt, preloadGift } from './art'
import { Burst, CrashScene } from './fx'
import { Bulbs, SlotDefs, SlotSym } from './slotart'
import { play } from './sfx'
import {
  CASES, caseOddsOf, GIFTS, GIFT_ORDER, MINES_COUNT, MINES_TOTAL, PAYLINES, PLINKO_RISK, SELL_RATE, type PlinkoRisk, SLOT3_PAY,
  STORM_PAY, SYMBOLS, caseChance, crashPoint, minesMult, money, pickSymbol, rint, rnd, upgradeChance, weighted,
  type Gift, type GiftKind, type Save,
} from './lib'

export type Ctx = {
  save: Save
  charge: (cost: number, title: string, countRound?: boolean) => boolean
  pay: (amount: number, title: string) => void
  notify: (msg: string) => void
  addGift: (kind: GiftKind, title: string) => Gift
  removeGift: (uid: string) => void
  bump: (key: string) => void
  tally: (staked: number, paid: number) => void // учёт для игр без обычной ставки/выплаты (кейсы, апгрейд)
  tilt: () => number // 0..0.3: насколько шансы ухудшены, если игрок слишком много выигрывает
}

// ---------- общие элементы ----------
export function StakeInput({ value, onChange, balance, disabled, presets = [10, 50, 100, 500] }:
  { value: number; onChange: (n: number) => void; balance: number; disabled?: boolean; presets?: number[] }) {
  const clamp = (n: number) => Math.max(1, Math.min(Math.floor(n) || 1, Math.max(1, balance)))
  return (
    <div className="stake-box">
      <label className="m small" htmlFor="stake">Ставка, ⭐</label>
      <div className="stake-line">
        <input id="stake" inputMode="numeric" value={value} disabled={disabled}
          onChange={e => onChange(clamp(Number(e.target.value.replace(/\D/g, ''))))} />
        <button disabled={disabled} onClick={() => onChange(clamp(value / 2))}>½</button>
        <button disabled={disabled} onClick={() => onChange(clamp(value * 2))}>×2</button>
      </div>
      <div className="stake-presets">
        {presets.map(p => <button key={p} disabled={disabled} className={p === value ? 'on' : ''} onClick={() => onChange(clamp(p))}>{p}</button>)}
        <button disabled={disabled} onClick={() => onChange(clamp(balance))}>Все</button>
      </div>
    </div>
  )
}
const Result = ({ children, good }: { children: React.ReactNode; good?: boolean }) =>
  <div className={`result ${good ? 'good' : ''}`}>{children}</div>

function useCount(target: number, ms = 700) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (!target) { setV(0); return }
    const t0 = performance.now(); let raf = 0
    const f = (now: number) => { const k = Math.min(1, (now - t0) / ms); setV(Math.round(target * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(f) }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}
// угол/сдвиг элемента из CSS-transform (для «тиков» во время анимации)
const matrixOf = (el: Element | null) => {
  if (!el) return null
  const t = getComputedStyle(el).transform
  if (!t || t === 'none') return null
  const m = t.match(/matrix\(([^)]+)\)/)
  return m ? m[1].split(',').map(Number) : null
}

// ---------- РАКЕТА ----------
export function Crash({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(50)
  const [phase, setPhase] = useState<'idle' | 'fly' | 'crash' | 'cash'>('idle')
  const [count, setCount] = useState(0) // обратный отсчёт перед стартом (3-2-1)
  const timer = useRef(0)
  const [auto, setAuto] = useState(0) // авто-вывод на этом множителе (0 = выключен)
  const [mult, setMult] = useState(1)
  const [win, setWin] = useState(0)
  const [hist, setHist] = useState<number[]>([])
  const raf = useRef(0)
  const live = useRef({ crashAt: 1, stake: 0, t0: 0, phase: 'idle' as string, mult: 1, auto: 0 })
  useEffect(() => () => { cancelAnimationFrame(raf.current); clearTimeout(timer.current) }, [])

  const finish = (kind: 'crash' | 'cash', m: number) => {
    cancelAnimationFrame(raf.current)
    live.current.phase = kind
    setPhase(kind); setMult(m)
    setHist(h => [live.current.crashAt, ...h].slice(0, 7))
  }
  const start = () => {
    if (phase === 'fly' || count > 0 || !ctx.charge(stake, 'Ракета — ставка')) return
    ctx.bump('crash')
    setPhase('idle'); setMult(1); setWin(0)
    const st = stake
    const launch = () => {
    play.whoosh()
    const L = live.current
    L.crashAt = Math.max(1, Math.floor((1 + (crashPoint() - 1) * (1 - ctx.tilt())) * 100) / 100); L.auto = auto; L.stake = st; L.t0 = performance.now(); L.phase = 'fly'; L.mult = 1
    setPhase('fly'); setMult(1); setWin(0)
    const tick = (now: number) => {
      if (L.phase !== 'fly') return
      const m = Math.floor(Math.exp(0.16 * ((now - L.t0) / 1000)) * 100) / 100
      if (m >= L.crashAt) { finish('crash', L.crashAt); play.boom(); play.lose(); ctx.notify(`Ракета улетела на ×${L.crashAt.toFixed(2)}`); return }
      L.mult = m; setMult(m)
      if (L.auto > 1 && m >= L.auto) { cash(); return }
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    }
    const step = (n: number) => {
      if (n === 0) { setCount(0); launch(); return }
      setCount(n); play.tick()
      timer.current = window.setTimeout(() => step(n - 1), 900)
    }
    step(3)
  }
  function cash() {
    const L = live.current
    if (L.phase !== 'fly') return
    const w = Math.floor(L.stake * L.mult)
    finish('cash', L.mult); setWin(w)
    ctx.pay(w, 'Ракета — выигрыш')
  }
  const flying = phase === 'fly'
  return (
    <div className="crash">
      <div className="chips">{hist.length ? hist.map((h, i) => <span key={i} className={h >= 2 ? 'g' : 'r'}>{h.toFixed(2)}×</span>) : <span className="m small">Прошлые раунды появятся здесь</span>}</div>
      <div className={`stage ${phase}`}>
        <CrashScene phase={phase} mult={mult} />
        <div className={`big-mult ${phase}`} key={phase === 'fly' ? Math.floor(mult) : 'x'}>{mult.toFixed(2)}×</div>
        {phase === 'crash' && <div className="boom">Улетела</div>}
        {phase === 'cash' && <div className="boom ok">Забрано +{money(win)}</div>}
        {count > 0 && <div className="countdown" key={count}>{count}</div>}
        {phase === 'idle' && count === 0 && <div className="boom m">Сделай ставку: перед стартом будет отсчёт 3-2-1</div>}
      </div>
      <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={flying || count > 0} />
      <div className="optrow"><span className="m small">Авто-вывод</span>
        {[0, 1.5, 2, 5, 10].map(v => <button key={v} className={auto === v ? 'on' : ''} disabled={flying || count > 0} onClick={() => setAuto(v)}>{v ? `×${v}` : 'Выкл'}</button>)}
      </div>
      {flying
        ? <button className="cta green pulse" onClick={cash}>Забрать {money(Math.floor(live.current.stake * mult))}</button>
        : <button className="cta" disabled={count > 0} onClick={start}>{count > 0 ? `Старт через ${count}…` : `Сделать ставку · ${money(stake)}`}</button>}
    </div>
  )
}

// ---------- АПГРЕЙД ПОДАРКОВ ----------
export function Upgrade({ ctx, seed }: { ctx: Ctx; seed: string | null }) {
  const gifts = ctx.save.gifts
  const prices = ctx.save.prices
  const [sel, setSel] = useState<string | null>(seed && gifts.some(g => g.uid === seed) ? seed : null)
  const [picker, setPicker] = useState(false)
  const [tpicker, setTpicker] = useState(false)
  const [ptab, setPtab] = useState<'mine' | 'market'>('mine')
  const [target, setTarget] = useState<GiftKind | null>(null)
  const [rot, setRot] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null)
  const [fx, setFx] = useState<'win' | 'burn' | null>(null)
  const needle = useRef<SVGGElement>(null)
  const cur = gifts.find(g => g.uid === sel) ?? null
  const curPrice = cur ? prices[cur.kind] : 0

  // все подарки дороже текущего (в том числе с очень малым шансом, например обычный → редкий NFT)
  const allTargets = useMemo(() =>
    cur ? GIFT_ORDER.filter(k => prices[k] > curPrice * 1.05) : [],
    [cur, curPrice, prices])
  // быстрые кнопки: ближайшие цели с заметным шансом
  const targets = useMemo(() => allTargets.filter(k => upgradeChance(curPrice, prices[k]) >= 0.02).slice(0, 16), [allTargets, curPrice, prices])
  useEffect(() => {
    if (!allTargets.length) setTarget(null)
    else if (!target || !allTargets.includes(target)) {
      const pool = targets.length ? targets : allTargets
      setTarget(pool[Math.min(1, pool.length - 1)])
    }
  }, [allTargets, targets, target])
  const pct = (c: number) => { const p = c * 100; return p >= 10 ? String(Math.round(p)) : p >= 1 ? p.toFixed(1).replace('.', ',') : p >= 0.01 ? p.toFixed(2).replace('.', ',') : '<0,01' }

  // тики при прохождении стрелки через деления
  useEffect(() => {
    if (!spinning) return
    let raf = 0, lastTick = -1
    const f = () => {
      const m = matrixOf(needle.current)
      if (m) { const deg = ((Math.atan2(m[1], m[0]) * 180) / Math.PI + 360) % 360, idx = Math.floor(deg / 6); if (idx !== lastTick) { lastTick = idx; play.tick() } }
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [spinning])

  const chance = cur && target ? upgradeChance(curPrice, prices[target]) : 0
  const mult = cur && target ? prices[target] / curPrice : 0
  const R = 78, C = 2 * Math.PI * R

  const go = () => {
    if (!cur || !target || spinning) return
    const ok = rnd() < chance * (1 - ctx.tilt())
    ctx.tally(curPrice, ok ? prices[target] : 0)
    const zone = chance * 360
    const angle = ok ? zone * (0.06 + rnd() * 0.88) : zone + (360 - zone) * (0.06 + rnd() * 0.88)
    const next = rot - (rot % 360) + 360 * 5 + angle
    const gift = cur, tgt = target
    setSpinning(true); setRes(null); setFx(null); setRot(next); play.whoosh()
    window.setTimeout(() => {
      ctx.removeGift(gift.uid)
      ctx.bump('upgrades')
      if (ok) {
        const g = ctx.addGift(tgt, 'Апгрейд — успех')
        ctx.notify(`Апгрейд удался: ${GIFTS[tgt]?.name} #${g.num}`)
        setRes({ ok: true, text: `Получено: ${GIFTS[tgt]?.name} #${g.num}` })
        setSel(g.uid); setFx('win'); play.big()
      } else {
        ctx.notify('Не повезло, подарок сгорел')
        setRes({ ok: false, text: `${GIFTS[gift.kind]?.name} #${gift.num} сгорел` })
        setSel(null); setFx('burn'); play.lose(); play.boom()
      }
      setSpinning(false)
    }, 4200)
  }

  const buyPick = (k: GiftKind) => {
    const p = prices[k]
    if (!ctx.charge(p, `Маркет — ${GIFTS[k]?.name}`, false)) return
    const ng = ctx.addGift(k, `Маркет — ${GIFTS[k]?.name}`)
    setSel(ng.uid); setPicker(false); setRes(null); setFx(null); play.click()
  }
  const market = GIFT_ORDER.filter(k => !GIFTS[k]?.nft).concat(GIFT_ORDER.filter(k => GIFTS[k]?.nft).slice(0, 12))
  const ticks = Array.from({ length: 60 }, (_, i) => i)
  return (
    <div className="upg">
      <div className="upg-pair">
        <div className={`upg-slot ${fx === 'burn' ? 'burn' : ''}`}>
          <span className="m small">Отдаёшь</span>
          {cur
            ? <button className="slot-btn" disabled={spinning} onClick={() => setPicker(true)}><GiftArt kind={cur.kind} size={88} /><b>{GIFTS[cur.kind]?.name} #{cur.num}</b><span className="gold">{money(curPrice)} ⭐</span></button>
            : <button className="slot-plus" disabled={spinning} onClick={() => { setPtab(gifts.length ? 'mine' : 'market'); setPicker(true) }} aria-label="Выбрать подарок"><span>+</span><b className="m small">{fx === 'burn' ? 'Сгорел. Выбери новый' : 'Выбрать подарок'}</b></button>}
          {fx === 'burn' && <Burst key="b" type="ember" n={60} />}
        </div>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a5bbb1" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 12h16M14 6l6 6-6 6" /></svg>
        <div className={`upg-slot ${fx === 'win' ? 'glow' : ''} ${spinning ? 'pending' : ''}`}>
          <span className="m small">Получаешь</span>
          {target ? <><GiftArt kind={target} size={88} animate={fx === 'win'} /><b>{GIFTS[target]?.name}</b><span className="gold">≈ {money(prices[target])} ⭐</span></> : <b className="m">{cur ? 'Выше нет' : '—'}</b>}
          {fx === 'win' && <Burst key="w" type="gold" n={90} />}
        </div>
      </div>

      <div className="upg-targets">
        {targets.map(k => (
          <button key={k} disabled={spinning} className={k === target ? 'on' : ''} onClick={() => { setTarget(k); play.click() }} title={GIFTS[k]?.name}>
            <GiftArt kind={k} size={28} glow={false} />
            <b>×{(prices[k] / curPrice).toFixed(1).replace('.', ',')}</b>
          </button>
        ))}
        {cur && allTargets.length > 0 && <button disabled={spinning} className="more" onClick={() => { setTpicker(true); play.click() }}>Все цели · {allTargets.length}</button>}
      </div>

      <div className={`dial ${spinning ? 'spinning' : ''}`}>
        <svg width="220" height="220" viewBox="0 0 210 210" role="img" aria-label={`Шанс успеха ${pct(chance)}%`}>
          <defs>
            <linearGradient id="arcg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#59b58d" /><stop offset="1" stopColor="#9ad2b8" /></linearGradient>
            <radialGradient id="disc"><stop offset="0" stopColor="#344a42" /><stop offset="1" stopColor="#202d28" /></radialGradient>
            <filter id="glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          <circle cx="105" cy="105" r="98" fill="url(#disc)" stroke="#374c44" strokeWidth="2" />
          {ticks.map(i => <line key={i} x1="105" y1="9" x2="105" y2={i % 5 === 0 ? 17 : 13} stroke={i % 5 === 0 ? '#79a190' : '#486a5c'} strokeWidth={i % 5 === 0 ? 2 : 1} transform={`rotate(${i * 6} 105 105)`} />)}
          <circle cx="105" cy="105" r={R} fill="none" stroke="#4a1c2c" strokeWidth="16" />
          <circle cx="105" cy="105" r={R} fill="none" stroke="url(#arcg)" strokeWidth="16" filter="url(#glow)"
            strokeDasharray={`${C * chance} ${C}`} transform="rotate(-90 105 105)" />
          <g ref={needle} style={{ transform: `rotate(${rot}deg)`, transformOrigin: '105px 105px', transition: spinning ? 'transform 4.1s cubic-bezier(.1,.72,.08,1)' : 'none' }}>
            <path d="M105 6l-9 22h18z" fill="#fff" filter="url(#glow)" />
            <rect x="103.5" y="26" width="3" height="22" rx="1.5" fill="#fff" opacity=".7" />
          </g>
        </svg>
        <div className="dial-text"><b>{pct(chance)}%</b><span className="m small">шанс успеха{mult ? ` · ×${mult.toFixed(1).replace('.', ',')}` : ''}</span></div>
      </div>

      {res && <Result good={res.ok}>{res.text}</Result>}
      <button className="cta" disabled={!cur || !target || spinning} onClick={go}>
        {spinning ? <><RotateCcw size={18} className="spin-icon" /> Крутится…</> : 'Апгрейд'}
      </button>
      <p className="m small center">Если не повезёт, подарок сгорит. Подарки существуют только внутри игры.</p>

      {tpicker && cur && (
        <div className="sheet-bg" onClick={() => setTpicker(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-tabs"><button className="on">Во что улучшить · {allTargets.length}</button></div>
            <p className="m small center">Чем дороже подарок, тем меньше шанс. Можно сразу прыгнуть на редкий, но шанс будет совсем мизерным.</p>
            <div className="sheet-list">
              {allTargets.map(k => { const c = upgradeChance(curPrice, prices[k]); return (
                <button key={k} className={k === target ? 'on' : ''} onClick={() => { setTarget(k); setTpicker(false); setRes(null); play.click() }}>
                  <GiftArt kind={k} size={44} glow={false} />
                  <span><b>{GIFTS[k]?.name}{GIFTS[k]?.nft ? ' · редкий' : ''}</b><i>{money(prices[k])} ⭐ · ×{(prices[k] / curPrice).toFixed(1).replace('.', ',')}</i></span>
                  <em className={`chance ${c < 0.01 ? 'tiny' : ''}`}>{pct(c)}%</em>
                </button>) })}
            </div>
            <button className="sheet-close" onClick={() => setTpicker(false)}>Закрыть</button>
          </div>
        </div>
      )}
      {picker && (
        <div className="sheet-bg" onClick={() => setPicker(false)}>
          <div className="sheet" onClick={e => e.stopPropagation()}>
            <div className="sheet-tabs">
              <button className={ptab === 'mine' ? 'on' : ''} onClick={() => setPtab('mine')}>Мои подарки · {gifts.length}</button>
              <button className={ptab === 'market' ? 'on' : ''} onClick={() => setPtab('market')}>Маркет</button>
            </div>
            <div className="sheet-list">
              {ptab === 'mine' && (gifts.length
                ? gifts.map(x => (
                  <button key={x.uid} className={x.uid === sel ? 'on' : ''} onClick={() => { setSel(x.uid); setPicker(false); setRes(null); setFx(null); play.click() }}>
                    <GiftArt kind={x.kind} size={44} glow={false} /><span><b>{GIFTS[x.kind]?.name} #{x.num}</b><i>{money(prices[x.kind])} ⭐</i></span>
                  </button>))
                : <p className="m small center">Подарков пока нет. Купи на маркете.</p>)}
              {ptab === 'market' && market.map(k => (
                <button key={k} disabled={ctx.save.balance < prices[k]} onClick={() => buyPick(k)}>
                  <GiftArt kind={k} size={44} glow={false} /><span><b>{GIFTS[k]?.name}</b><i>Купить за {money(prices[k])}</i></span>
                </button>))}
            </div>
            <button className="sheet-close" onClick={() => setPicker(false)}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- ШТОРМ (слот 5×3) ----------
const PITCH = 68
function stormTotal(f: string[][], stake: number, cells?: Set<string>) {
  let total = 0
  const lineBet = stake / PAYLINES.length
  for (const line of PAYLINES) {
    const s = f[0][line[0]]
    let run = 1
    while (run < 5 && f[run][line[run]] === s) run++
    if (run >= 3) { total += lineBet * STORM_PAY(s, run); if (cells) for (let i = 0; i < run; i++) cells.add(`${i},${line[i]}`) }
  }
  return Math.floor(total)
}

export function Storm({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(90)
  const [cols, setCols] = useState<string[][]>(() => Array.from({ length: 5 }, () => [pickSymbol(), pickSymbol(), pickSymbol()]))
  const [strips, setStrips] = useState<string[][] | null>(null) // во время спина: длинные ленты
  const [spinId, setSpinId] = useState(0)
  const [busy, setBusy] = useState(false)
  const [hit, setHit] = useState<Set<string>>(new Set())
  const [win, setWin] = useState(0)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const shown = useCount(win)

  const spin = () => {
    if (busy || !ctx.charge(stake, 'Шторм — ставка')) return
    ctx.bump('storm'); play.whoosh()
    setWin(0); setHit(new Set()); setBusy(true)
    const gen = () => Array.from({ length: 5 }, () => Array.from({ length: 3 }, pickSymbol))
    let final = gen()
    if (stormTotal(final, stake) > 0 && rnd() < ctx.tilt() * 1.5) final = gen()
    setStrips(cols.map((cur, c) => [...cur, ...Array.from({ length: 12 }, pickSymbol), ...final[c]]))
    setSpinId(i => i + 1)
    for (let c = 0; c < 5; c++) timers.current.push(window.setTimeout(() => play.stop(), 900 + c * 280))
    timers.current.push(window.setTimeout(() => { setCols(final); setStrips(null); setBusy(false); settle(final) }, 900 + 4 * 280 + 120))
  }
  const settle = (f: string[][]) => {
    const cells = new Set<string>()
    const total = stormTotal(f, stake, cells)
    setHit(cells); setWin(total)
    if (total > 0) { ctx.pay(total, 'Шторм — выигрыш'); if (total >= stake * 5) play.big() } else ctx.notify('Комбинация не собрана')
  }
  return (
    <div className="storm">
      <SlotDefs />
      <div className={`cab ${win > 0 ? 'winning' : ''} ${busy ? 'spinning' : ''}`}>
        <div className="marquee"><Bulbs n={14} /><b>STORM</b><span>9 линий · 5 барабанов</span><Bulbs n={14} /></div>
        <div className="reels5">
          {cols.map((col, c) => (
            <div key={c} className="reel-win">
              {strips ? (
                <div key={spinId} className="strip run" style={{ ['--end' as string]: `${-(strips[c].length - 3) * PITCH}px`, ['--dur' as string]: `${0.9 + c * 0.28}s` }}>
                  {strips[c].map((s, i) => <div key={i} className="cell"><SlotSym s={s} /></div>)}
                </div>
              ) : (
                <div className="strip">{col.map((s, r) => <div key={r} className={`cell ${hit.has(`${c},${r}`) ? 'hit' : ''}`}><SlotSym s={s} /></div>)}</div>
              )}
              <i className="glass" />
            </div>
          ))}
          {win > 0 && <Burst key={win} type="gold" n={80} />}
        </div>
      </div>
      <details className="paytable"><summary>Таблица выплат</summary>
        <div className="pt-grid">{SYMBOLS.map(sy => <div key={sy}><span className="pt-sym"><SlotSym s={sy} /></span><small>3 · ×{STORM_PAY(sy, 3)}</small><small>4 · ×{STORM_PAY(sy, 4)}</small><small>5 · ×{STORM_PAY(sy, 5)}</small></div>)}</div>
        <p className="m small">Множители на ставку линии (ставка делится на 9 линий).</p>
      </details>
      {win > 0 ? <Result good>Выигрыш +{money(shown)}</Result> : <p className="m small center">9 линий, выигрыш от 3 одинаковых символов слева направо. Ставка делится на линии.</p>}
      <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={busy} />
      <button className="cta" disabled={busy} onClick={spin}>{busy ? 'Барабаны крутятся…' : `Спин · ${money(stake)}`}</button>
    </div>
  )
}

// ---------- БЫСТРЫЕ СЛОТЫ (3 барабана) ----------
export function Slots({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(20)
  const [reels, setReels] = useState(['💎', '7⭐', '🍀'])
  const [stopped, setStopped] = useState([true, true, true])
  const [busy, setBusy] = useState(false)
  const [win, setWin] = useState<number | null>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(t => { clearTimeout(t); clearInterval(t) }), [])
  const shown = useCount(win || 0)
  const spin = () => {
    if (busy || !ctx.charge(stake, 'Слоты — ставка')) return
    ctx.bump('slots'); play.whoosh()
    setBusy(true); setWin(null); setStopped([false, false, false])
    let final = [pickSymbol(), pickSymbol(), pickSymbol()]
    if (final[0] === final[1] && final[1] === final[2] && rnd() < ctx.tilt() * 1.5) final = [pickSymbol(), pickSymbol(), pickSymbol()]
    const st = [false, false, false]
    const iv = window.setInterval(() => setReels(r => r.map((s, i) => st[i] ? s : pickSymbol())), 60)
    timers.current.push(iv)
    final.forEach((s, i) => timers.current.push(window.setTimeout(() => {
      st[i] = true; play.stop()
      setReels(r => r.map((x, j) => j === i ? s : x)); setStopped([...st])
      if (i === 2) {
        clearInterval(iv)
        const w = final[0] === final[1] && final[1] === final[2] ? Math.floor(stake * SLOT3_PAY(final[0])) : 0
        setWin(w); setBusy(false)
        if (w > 0) { ctx.pay(w, 'Слоты — выигрыш'); play.big() } else ctx.notify('Комбинация не собрана')
      }
    }, 700 + i * 380)))
  }
  return (
    <div className="storm">
      <SlotDefs />
      <div className={`cab quick ${win ? 'winning' : ''} ${busy ? 'spinning' : ''}`}>
        <div className="marquee"><Bulbs n={10} /><b>QUICK SPIN</b><span>три в ряд</span><Bulbs n={10} /></div>
        <div className="reels three">
          {reels.map((s, i) => <div key={i} className={`cell big ${stopped[i] ? 'pop' : 'blur'} ${win ? 'hit' : ''}`}><SlotSym s={s} /><i className="glass" /></div>)}
          {!!win && <Burst key={win} type="gold" n={90} />}
        </div>
      </div>
      <details className="paytable"><summary>Таблица выплат</summary>
        <div className="pt-grid">{SYMBOLS.map(sy => <div key={sy}><span className="pt-sym"><SlotSym s={sy} /></span><small>3 · ×{SLOT3_PAY(sy)}</small></div>)}</div>
      </details>
      {win ? <Result good>Выигрыш +{money(shown)}</Result> : <p className="m small center">Три одинаковых символа дают выигрыш. Самый редкий символ — бриллиант.</p>}
      <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={busy} presets={[5, 20, 100, 500]} />
      <button className="cta" disabled={busy} onClick={spin}>{busy ? 'Крутится…' : `Спин · ${money(stake)}`}</button>
    </div>
  )
}

// ---------- КЕЙС (лента-рулетка) ----------
const CELL = 100
export function Cases({ ctx, caseId }: { ctx: Ctx; caseId?: string | null }) {
  const C = CASES.find(c => c.id === caseId) || CASES[0] || { id: '', name: '', color: '#fff', pool: [] as string[], weights: [] as number[], price: 0, ev: 0 }
  const [phase, setPhase] = useState<'idle' | 'shake' | 'roll' | 'done'>('idle')
  const [strip, setStrip] = useState<GiftKind[]>(() => Array.from({ length: 12 }, () => C.pool[rint(C.pool.length)]))
  const [x, setX] = useState(0)
  const [anim, setAnim] = useState(false)
  const [win, setWin] = useState(36)
  const [got, setGot] = useState<Gift | null>(null)
  const [fast, setFast] = useState(false) // быстрое открытие без рулетки
  const view = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  useEffect(() => {
    if (phase !== 'roll') return
    let raf = 0, last = -1
    const f = () => {
      const m = matrixOf(track.current)
      if (m) { const idx = Math.floor((-m[4] + (view.current?.clientWidth || 0) / 2) / CELL); if (idx !== last) { last = idx; play.tick() } }
      raf = requestAnimationFrame(f)
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const open = () => {
    if ((phase === 'shake' || phase === 'roll') || !C.pool.length || !ctx.charge(C.price, 'Кейс — открытие')) return
    ctx.bump('cases')
    const t = ctx.tilt()
    const kind = weighted(C.pool, t ? C.weights.map((w, i) => w * Math.pow(1 / (GIFTS[C.pool[i]]?.base || 1), t * 0.8)) : C.weights)
    ctx.tally(0, ctx.save.prices[kind] || 0)
    if (fast) { setGot(ctx.addGift(kind, 'Кейс — подарок')); setPhase('done'); play.big(); return }

    // Новая лента продолжает старую: видимые сейчас подарки остаются на тех же местах, поэтому ничего не пропадает и не мигает
    const KEEP = 10, WIN = KEEP + 30
    const a = Math.max(0, Math.floor(-x / CELL))
    const keep = strip.slice(a, a + KEEP)
    while (keep.length < KEEP) keep.push(C.pool[rint(C.pool.length)])
    const s = [...keep, ...Array.from({ length: 40 }, () => C.pool[rint(C.pool.length)])]
    s[WIN] = kind
    const off = Math.min(0, x + a * CELL)
    setGot(null); setPhase('shake'); play.whoosh()

    // пока кейс трясётся, подгружаем картинки и анимации новых подарков (не дольше 1,5 с)
    const ready = Promise.race([Promise.all([...new Set(s)].map(k => preloadGift(k, k === kind))), new Promise(r => timers.current.push(window.setTimeout(r, 1500)))])
    const minWait = new Promise(r => timers.current.push(window.setTimeout(r, 700)))
    Promise.all([ready, minWait]).then(() => {
      if (!alive.current) return
      setAnim(false); setStrip(s); setX(off); setWin(WIN)
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!alive.current) return
        const vw = view.current?.clientWidth || 340
        const final = -(WIN * CELL + CELL / 2 - vw / 2 + (rnd() - 0.5) * (CELL * 0.6))
        setPhase('roll'); setAnim(true); setX(final)
        timers.current.push(window.setTimeout(() => {
          setGot(ctx.addGift(kind, 'Кейс — подарок')); setPhase('done'); play.big()
        }, 5400))
      }))
    })
  }
  const busy = phase === 'shake' || phase === 'roll'
  return (
    <div className="cases">
      <div className={`roll-view ${phase}`} ref={view}>
        <div className="roll-marker" />
        <div ref={track} className="roll-track" style={{ transform: `translateX(${x}px)`, transition: anim ? 'transform 5.2s cubic-bezier(.08,.6,.06,1)' : 'none' }}>
          {strip.map((k, i) => (
            <div key={i} className={`roll-cell ${phase === 'done' && i === win ? 'won' : ''}`} style={{ width: CELL }}>
              <GiftArt kind={k} size={76} animate={phase === 'done' && i === win} />
            </div>
          ))}
        </div>
        {phase === 'done' && <Burst key="d" type="confetti" n={90} />}
      </div>
      {got
        ? <Result good>Выпало: {GIFTS[got.kind]?.name} #{got.num} · ≈{money(ctx.save.prices[got.kind])} ⭐</Result>
        : <p className="m small center">Внутри один из {C.pool.length} подарков. Чаще всего {GIFTS[C.pool[0]]?.name} ({caseOddsOf(C, 0).toFixed(0)}%), реже всего {GIFTS[C.pool[C.pool.length - 1]]?.name} ({caseOddsOf(C, C.pool.length - 1).toFixed(2).replace('.', ',')}%).</p>}
      <label className="fastopt"><input type="checkbox" checked={fast} disabled={busy} onChange={e => setFast(e.target.checked)} /> Быстрое открытие</label>
      {got && !busy && <button className="cta ghost" onClick={() => { const v = Math.floor(ctx.save.prices[got.kind] * SELL_RATE); ctx.removeGift(got.uid); ctx.pay(v, `Продажа — ${GIFTS[got.kind]?.name}`); setGot(null); setPhase('idle'); play.coin() }}>Продать за {money(Math.floor(ctx.save.prices[got.kind] * SELL_RATE))}</button>}
      <button className="cta" disabled={busy} onClick={open}>{busy ? 'Открываем…' : `Открыть · ${C.price}`}</button>
      <h3 className="sub-title">Что внутри · {C.name}</h3>
      <div className="case-items">
        {C.pool.map((k, i) => ({ k, i })).sort((a, b) => GIFTS[b.k].base - GIFTS[a.k].base).map(({ k, i }) => (
          <div key={k} className={`case-item ${GIFTS[k].base > C.price ? 'up' : ''}`}>
            <GiftArt kind={k} size={52} glow={false} />
            <b>{GIFTS[k].name}</b>
            <span className="gold">{money(GIFTS[k].base)}</span>
            <i>{caseOddsOf(C, i) < 1 ? caseOddsOf(C, i).toFixed(2).replace('.', ',') : caseOddsOf(C, i).toFixed(1).replace('.', ',')}%</i>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- МИНЫ ----------
export function Mines({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(50)
  const [bn, setBn] = useState(3) // число мин на поле
  const [bombs, setBombs] = useState<Set<number> | null>(null)
  const [open, setOpen] = useState<number[]>([])
  const [over, setOver] = useState<'none' | 'boom' | 'cash'>('none')
  const active = !!bombs && over === 'none'
  const mult = minesMult(open.length, bn)
  const start = () => {
    if (!ctx.charge(stake, 'Мины — ставка')) return
    ctx.bump('mines'); play.click()
    const b = new Set<number>()
    while (b.size < bn) b.add(rint(MINES_TOTAL))
    setBombs(b); setOpen([]); setOver('none')
  }
  const tap = (i: number) => {
    if (!active || open.includes(i)) return
    setOpen(o => [...o, i])
    if (!bombs!.has(i) && open.length >= 1 && rnd() < ctx.tilt() * 0.35) { const nb = new Set(bombs!); nb.add(i); setBombs(nb); bombs!.add(i) }
    if (bombs!.has(i)) { setOver('boom'); play.boom(); play.lose(); ctx.notify('Мина! Ставка сгорела'); return }
    play.flip(); play.coin()
    if (open.length + 1 === MINES_TOTAL - bn) cashOut(open.length + 1)
  }
  const cashOut = (k = open.length) => {
    if (!active || k === 0) return
    setOver('cash'); ctx.pay(Math.floor(stake * minesMult(k, bn)), 'Мины — выигрыш')
  }
  return (
    <div className="mines">
      <div className={`mgrid ${over === 'boom' ? 'shake-grid' : ''}`}>
        {Array.from({ length: MINES_TOTAL }, (_, i) => {
          const isOpen = open.includes(i), isBomb = !!bombs?.has(i), reveal = over !== 'none' && !isOpen
          const flipped = isOpen || reveal
          return (
            <button key={i} disabled={!active} onClick={() => tap(i)} className={`mcell ${flipped ? 'flip' : ''} ${reveal ? 'ghost' : ''}`} aria-label={`Клетка ${i + 1}`}>
              {flipped
                ? <span className={`face ${isBomb ? 'bomb' : 'safe'}`}>{isBomb ? '💣' : '💎'}</span>
                : <span className="face front" />}
            </button>
          )
        })}
        {over === 'boom' && <Burst key="boom" type="ember" n={80} />}
        {over === 'cash' && <Burst key="cash" type="gold" n={80} />}
      </div>
      <p className="m small center">Мин: {bn}. Сейчас ×{mult.toFixed(2)}{active && open.length ? ` · забрать ${money(Math.floor(stake * mult))}` : ''}</p>
      {over === 'cash' && <Result good>Забрано +{money(Math.floor(stake * mult))}</Result>}
      <div className="optrow"><span className="m small">Мин</span>
        {[1, 3, 5, 8, 12].map(v => <button key={v} className={bn === v ? 'on' : ''} disabled={active} onClick={() => setBn(v)}>{v}</button>)}
      </div>
      <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={active} />
      {active
        ? <button className="cta green" disabled={!open.length} onClick={() => cashOut()}>Забрать {money(Math.floor(stake * mult))}</button>
        : <button className="cta" onClick={start}>{bombs ? 'Новый раунд' : 'Начать'} · {money(stake)}</button>}
    </div>
  )
}

// ---------- PLINKO (отскоки по колышкам) ----------
export function Plinko({ ctx }: { ctx: Ctx }) {
  const ROWS = 8, W = 300, SX = 30, SY = 25, TOP = 28
  const [stake, setStake] = useState(50)
  const [ball, setBall] = useState<{ x: number; y: number; s: number; trail: { x: number; y: number }[] } | null>(null)
  const [hot, setHot] = useState<string | null>(null)
  const [landed, setLanded] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [risk, setRisk] = useState<PlinkoRisk>('mid')
  const MULTS = PLINKO_RISK[risk]
  const raf = useRef(0)
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  const pegX = (r: number, c: number) => W / 2 + (c - (r + 1) / 2) * SX   // ряд r содержит r+2 колышка
  const pegY = (r: number) => TOP + r * SY
  const drop = () => {
    if (busy || !ctx.charge(stake, 'Plinko — ставка')) return
    ctx.bump('plinko'); play.whoosh()
    setBusy(true); setLanded(null); setHot(null)
    const t = ctx.tilt()
    const steps: (0 | 1)[] = []
    for (let r = 0, k = 0; r < ROWS; r++) {
      // при серии выигрышей шар чаще тянет к центру, где множители ниже
      const toCentre: 0 | 1 = k < r / 2 ? 1 : 0
      const s = (rnd() < t * 0.5 ? toCentre : rnd() < 0.5 ? 0 : 1) as 0 | 1
      steps.push(s); k += s
    }
    const slot = steps.reduce<number>((a, b) => a + b, 0) // исход выбран заранее, физика его только «разыгрывает»
    const kk: number[] = []
    for (let r = 0, k = 0; r < ROWS; r++) { k += steps[r]; kk.push(k) } // колышек ряда r, на который должен попасть шар

    // ---- физика: гравитация, упругие столкновения с колышками, стенки и пол ----
    const G = 640, R = 5.6, RP = 3.2, E = 0.52, H = 1 / 240
    const BW = W / (ROWS + 1), WALL_TOP = 216 // перегородки между ячейками: шар не может перелететь в соседнюю
    const FLOOR = pegY(ROWS - 1) + 59 // пол внутри ячеек с множителями: шар «проваливается» в ячейку
    const binX = W / 2 + (slot - ROWS / 2) * (W / (ROWS + 1))
    const pegs: { x: number; y: number; r: number; c: number }[] = []
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < r + 2; c++) pegs.push({ x: pegX(r, c), y: pegY(r), r, c })
    let x = pegX(0, kk[0]) + (rnd() - 0.5) * 3, y = 4, vx = (rnd() - 0.5) * 6, vy = 0
    let row = 0, elapsed = 0, floorAt = -1, hotAt = -1, tickAt = -1
    let maxY = y, progAt = 0 // защита от зависания: если шар долго не опускается, подталкиваем его к цели
    const trail: { x: number; y: number }[] = []

    // после удара подбираем горизонтальную скорость так, чтобы по параболе долететь до колышка следующего ряда (или до своей ячейки)
    const aim = (fromRow: number) => {
      const last = fromRow + 1 >= ROWS
      const tx = last ? binX + (rnd() - 0.5) * 8 : pegX(fromRow + 1, kk[fromRow + 1]) + (rnd() - 0.5) * 5
      const ty = last ? FLOOR - R : pegY(fromRow + 1) - (R + RP) - 0.5
      const disc = vy * vy + 2 * G * (ty - y)
      const tt = disc > 0 ? (-vy + Math.sqrt(disc)) / G : 0.2
      vx = (tx - x) / Math.max(tt, 0.08)
    }
    const unstick = () => {
      const stuckFor = elapsed - progAt
      if (stuckFor < 0.3 || floorAt >= 0) return
      const nr = Math.min(row + 1, ROWS - 1)
      const tx = row + 1 >= ROWS ? binX : pegX(nr, kk[nr])
      if (stuckFor > 0.9) { // крайняя мера: переносим шар в просвет над целевым колышком
        x = tx; y = Math.max(y, row + 1 >= ROWS ? y : pegY(nr) - 16); vx = 0; vy = 90; progAt = elapsed; return
      }
      vx = Math.sign(tx - x || 1) * Math.max(70, Math.min(160, Math.abs(tx - x) * 6)); vy = Math.max(vy, 40)
      progAt = elapsed - 0.3 + 0.12 // повторим толчок через ~0.18 с, если не помогло
    }
    const step = () => {
      vy += G * H; x += vx * H; y += vy * H
      if (y > maxY + 1.5) { maxY = y; progAt = elapsed }
      else unstick()
      if (x < R) { x = R; vx = Math.abs(vx) * 0.5 }
      if (x > W - R) { x = W - R; vx = -Math.abs(vx) * 0.5 }
      for (const p of pegs) {
        if (Math.abs(p.y - y) > R + RP) continue
        const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy), m = R + RP
        if (d >= m || d === 0) continue
        const nx = dx / d, ny = dy / d
        x = p.x + nx * m; y = p.y + ny * m          // вытолкнуть из колышка
        const vn = vx * nx + vy * ny
        if (vn < 0) {
          vx -= (1 + E) * vn * nx; vy -= (1 + E) * vn * ny // отскок с потерей энергии
          vx *= 0.96
          if (vy > -45) vy = -45                           // шар не «прилипает» к колышку
          aim(p.r); row = p.r
          hotAt = elapsed
          setHot(`${p.r}-${p.c}`)
          if (elapsed - tickAt > 0.05) { tickAt = elapsed; play.tick() }
        }
      }
      if (y + R > WALL_TOP) {
        const lo = slot * BW + R + 1.5, hi = (slot + 1) * BW - R - 1.5
        if (x < lo) { x = lo; vx = Math.abs(vx) * 0.3 } else if (x > hi) { x = hi; vx = -Math.abs(vx) * 0.3 }
      }
      if (y >= FLOOR - R) {
        y = FLOOR - R
        if (vy > 0) { vy = -vy * 0.38; vx *= 0.8 }
        if (floorAt < 0) floorAt = elapsed
      }
    }
    let prev = performance.now(), acc = 0, over = false
    const f = (now: number) => {
      if (over) return
      acc += Math.min(0.05, (now - prev) / 1000); prev = now
      while (acc >= H) { step(); elapsed += H; acc -= H }
      trail.push({ x, y }); if (trail.length > 7) trail.shift()
      if (hotAt >= 0 && elapsed - hotAt > 0.12) { hotAt = -1; setHot(null) }
      setBall({ x, y, s: row, trail: [...trail] })
      if ((floorAt >= 0 && elapsed - floorAt > 0.4) || elapsed > 7) { // приземлился (или страховка по времени)
        over = true
        setBall(null); setHot(null); setLanded(slot); setBusy(false)
        const w = Math.floor(stake * MULTS[slot])
        if (w > 0) { ctx.pay(w, 'Plinko — выигрыш'); if (MULTS[slot] >= 3) play.big() }
        return
      }
      raf.current = requestAnimationFrame(f)
    }
    raf.current = requestAnimationFrame(f)
  }
  return (
    <div className="plinko">
      <svg viewBox="0 0 300 275" className="pboard" role="img" aria-label="Поле Plinko с множителями">
        {Array.from({ length: ROWS }, (_, r) => Array.from({ length: r + 2 }, (_, c) =>
          <circle key={`${r}-${c}`} cx={pegX(r, c)} cy={pegY(r)} r={hot === `${r}-${c}` ? 4.6 : 3.2} fill={hot === `${r}-${c}` ? '#FFE08A' : '#8fb3a2'} />))}
        {Array.from({ length: ROWS + 2 }, (_, i) => <rect key={`w${i}`} x={i * (W / (ROWS + 1)) - 1.2} y={216} width={2.4} height={52} rx={1.2} fill="#7fb59d" opacity={0.85} />)}
        {MULTS.map((m, i) => {
          const cx = W / 2 + (i - ROWS / 2) * (W / (ROWS + 1)), w = W / (ROWS + 1) - 5, on = landed === i || (!!ball && ball.y > 222 && Math.floor(ball.x / (W / (ROWS + 1))) === i)
          const hi = m >= 3, lo = m < 1
          return <g key={`b${i}`} transform={on ? `translate(0 -3)` : undefined}>
            <rect x={cx - w / 2} y={238} width={w} height={28} rx={6} fill={on ? '#ffd166' : hi ? '#5b3d12' : lo ? '#4a2436' : '#2f5646'} stroke={on ? '#fff3c4' : hi ? '#b8892e' : lo ? '#7a3b57' : '#4f8a73'} strokeWidth={on ? 1.6 : 1} />
            <text x={cx} y={256} textAnchor="middle" fontSize={m >= 10 ? 10 : 11.5} fontWeight={800} fill={on ? '#1a1304' : hi ? '#ffc24b' : lo ? '#ff9db8' : '#d6efe2'}>{m}×</text>
          </g>
        })}
        {ball && <>
          {ball.trail.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={2 + i * 0.5} fill="#FFC24B" opacity={0.04 + i * 0.03} />)}
          <circle cx={ball.x} cy={ball.y} r="8.5" fill="#FFC24B" opacity=".22" /><circle cx={ball.x} cy={ball.y} r="5.6" fill="url(#pb)" />
        </>}
        <defs><radialGradient id="pb" cx=".35" cy=".3"><stop offset="0" stopColor="#fff6d0" /><stop offset="1" stopColor="#f0a21b" /></radialGradient></defs>
      </svg>
      {landed !== null && <Result good={MULTS[landed] >= 1}>×{MULTS[landed]} · {MULTS[landed] >= 1 ? '+' : ''}{money(Math.floor(stake * MULTS[landed]))}</Result>}
      <div className="optrow"><span className="m small">Риск</span>
        {([['low', 'Низкий'], ['mid', 'Средний'], ['high', 'Высокий']] as [PlinkoRisk, string][]).map(([v, t]) => <button key={v} className={risk === v ? 'on' : ''} disabled={busy} onClick={() => setRisk(v)}>{t}</button>)}
      </div>
      <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={busy} />
      <button className="cta" disabled={busy} onClick={drop}>{busy ? 'Шар падает…' : `Бросить · ${money(stake)}`}</button>
    </div>
  )
}

// ---------- БЛЭКДЖЕК ----------
type Card = { r: string; v: number; s: string }
const mkDeck = (): Card[] => {
  const d: Card[] = []
  for (const s of ['♠', '♥', '♦', '♣']) for (const [r, v] of [['A', 11], ['2', 2], ['3', 3], ['4', 4], ['5', 5], ['6', 6], ['7', 7], ['8', 8], ['9', 9], ['10', 10], ['J', 10], ['Q', 10], ['K', 10]] as [string, number][]) d.push({ r, v, s })
  for (let i = d.length - 1; i > 0; i--) { const j = rint(i + 1); [d[i], d[j]] = [d[j], d[i]] }
  return d
}
const score = (h: Card[]) => {
  let t = h.reduce((a, c) => a + c.v, 0), aces = h.filter(c => c.r === 'A').length
  while (t > 21 && aces) { t -= 10; aces-- }
  return t
}
const CardView = ({ c, hidden, i }: { c: Card; hidden?: boolean; i: number }) =>
  <div className={`pcard deal ${hidden ? 'back' : c.s === '♥' || c.s === '♦' ? 'red' : ''}`} style={{ animationDelay: `${i * 0.12}s` }}>{hidden ? '' : <>{c.r}<small>{c.s}</small></>}</div>

export function Blackjack({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(50)
  const [deck, setDeck] = useState<Card[]>([])
  const [pl, setPl] = useState<Card[]>([])
  const [de, setDe] = useState<Card[]>([])
  const [phase, setPhase] = useState<'bet' | 'play' | 'done'>('bet')
  const [msg, setMsg] = useState('')
  const [locked, setLocked] = useState(0)
  const finish = (p: Card[], d: Card[], bet: number, natural = false) => {
    const ps = score(p), ds = score(d)
    let pay = 0, text = ''
    if (ps > 21) text = 'Перебор'
    else if (natural && ds !== 21) { pay = Math.floor(bet * 2.5); text = 'Блэкджек!' }
    else if (ds > 21 || ps > ds) { pay = bet * 2; text = 'Победа' }
    else if (ps === ds) { pay = bet; text = 'Ничья, ставка возвращена' }
    else text = 'Проигрыш'
    setMsg(text); setPhase('done')
    if (pay > bet) play.big(); else if (pay === 0) play.lose()
    if (pay > 0) ctx.pay(pay, `Блэкджек — ${text.toLowerCase()}`)
  }
  const deal = () => {
    if (!ctx.charge(stake, 'Блэкджек — ставка')) return
    ctx.bump('blackjack'); play.flip()
    const d = mkDeck()
    const p = [d.pop()!, d.pop()!], dl = [d.pop()!, d.pop()!]
    if (rnd() < ctx.tilt() * 0.5) { const bi = d.reduce((m, c, i) => (c.v > d[m].v ? i : m), 0); if (d[bi].v > dl[1].v) [dl[1], d[bi]] = [d[bi], dl[1]] } // скрытая карта дилера
    setDeck(d); setPl(p); setDe(dl); setLocked(stake); setMsg(''); setPhase('play')
    if (score(p) === 21) finish(p, dl, stake, true)
  }
  const hit = () => {
    const d = [...deck], p = [...pl, d.pop()!]
    play.flip(); setDeck(d); setPl(p)
    if (score(p) >= 21) stand(p, d)
  }
  const dbl = () => {
    if (pl.length !== 2 || !ctx.charge(locked, 'Блэкджек — удвоение', false)) return
    const d = [...deck], p = [...pl, d.pop()!]
    play.flip(); setDeck(d); setPl(p); setLocked(locked * 2)
    stand(p, d, locked * 2)
  }
  const stand = (p = pl, d0 = deck, bet = locked) => {
    const d = [...d0], dl = [...de]
    while (score(dl) < 17) dl.push(d.pop()!)
    setDe(dl); setDeck(d); finish(p, dl, bet)
  }
  return (
    <div className="bj">
      <div className="felt">
        <div className="hand"><span className="m small">Дилер {phase === 'play' ? '' : de.length ? score(de) : ''}</span>
          <div className="cards">{de.map((c, i) => <CardView key={`${phase === 'play' ? 'p' : 'r'}${i}${c.r}${c.s}`} c={c} hidden={phase === 'play' && i === 1} i={i} />)}</div></div>
        <div className="hand"><span className="m small">Ты {pl.length ? score(pl) : ''}</span>
          <div className="cards">{pl.map((c, i) => <CardView key={`${i}${c.r}${c.s}`} c={c} i={i} />)}</div></div>
      </div>
      {msg && <Result good={/Победа|Блэкджек/.test(msg)}>{msg}</Result>}
      {phase !== 'play' && <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} />}
      {phase === 'play'
        ? <div className="two three"><button className="cta ghost" onClick={hit}>Ещё</button><button className="cta" onClick={() => stand()}>Хватит</button><button className="cta gold" disabled={pl.length !== 2 || ctx.save.balance < locked} onClick={dbl}>×2</button></div>
        : <button className="cta" onClick={deal}>Раздать · {money(stake)}</button>}
      <p className="m small center">Блэкджек платит 3:2, дилер берёт до 17.</p>
    </div>
  )
}

// ---------- ОСОБНЯК ----------
const HOUSE_RTP = 0.95
export function Mansion({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(50)
  const [n, setN] = useState(3) // число дверей: за одной награда
  const mult = HOUSE_RTP * n
  const [prize, setPrize] = useState<number | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const [won, setWon] = useState(0)
  const busy = picked !== null
  const start = useCallback(() => { setPrize(null); setPicked(null); setWon(0) }, [])
  const choose = (i: number) => {
    if (busy) return
    if (!ctx.charge(stake, 'Особняк — ставка')) return
    ctx.bump('mansion'); play.click()
    let p = rint(n)
    if (p === i && rnd() < ctx.tilt()) p = (i + 1 + rint(n - 1)) % n
    const w = p === i ? Math.floor(stake * mult) : 0
    setPrize(p); setPicked(i); setWon(w)
    window.setTimeout(() => { if (w > 0) { ctx.pay(w, 'Особняк — находка'); play.big() } else { ctx.notify('За дверью пусто'); play.lose() } }, 600)
  }
  const cols = n <= 4 ? n : 3
  return (
    <div className="mansion">
      <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={busy} />
      <div className="optrow"><span className="m small">Дверей</span>
        {[2, 3, 4, 5, 6].map(v => <button key={v} className={n === v ? 'on' : ''} disabled={busy} onClick={() => { setN(v); play.click() }}>{v}</button>)}
      </div>
      <p className="m small center">Награда за одной из {n} дверей: <b className="gold">×{mult.toFixed(2).replace('.', ',')}</b> · выигрыш {money(Math.floor(stake * mult))} ⭐</p>
      <div className="doors" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: n }, (_, i) => {
          const open = picked !== null
          const cls = `door ${n > 4 ? 'sm' : ''} ${open ? 'open' : ''} ${open && i === prize ? 'win' : ''} ${open && i === picked && i !== prize ? 'lose' : ''}`
          return (
            <div key={i} role="button" tabIndex={open ? -1 : 0} aria-label={`Дверь ${i + 1}`} className={cls}
              onClick={() => choose(i)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') choose(i) }}>
              <div className="frame">
                <div className="room"><span className="behind">{open ? (i === prize ? '💰' : '🕸️') : ''}</span></div>
                <div className="leaf">
                  <i className="pn p1" /><i className="pn p2" /><i className="pn p3" /><i className="pn p4" />
                  <i className="knob" /><i className="plate">{i + 1}</i>
                </div>
              </div>
              {open && i === prize && picked === prize && <Burst key="g" type="gold" n={60} />}
            </div>
          )
        })}
      </div>
      {picked === null && <p className="m small center">Выбери дверь: ставка спишется при открытии.</p>}
      {picked !== null && <><Result good={picked === prize}>{picked === prize ? `Нашёл! +${money(won)} ⭐` : 'Пусто. Попробуй ещё раз'}</Result><button className="cta" onClick={start}>Ещё раз</button></>}
    </div>
  )
}

// ---------- ОРЁЛ И РЕШКА ----------
type Side = 'heads' | 'tails'
const COIN_RTP = 0.95
const SIDE_NAME: Record<Side, string> = { heads: 'Орёл', tails: 'Решка' }
function CoinFace({ side }: { side: Side }) {
  // общий чекан: рант, жемчужный поясок, внутренний валик
  const rim = <>
    <circle cx="50" cy="50" r="48" fill="none" stroke="url(#cgRim)" strokeWidth="3" />
    <circle cx="50" cy="50" r="44.500" fill="none" stroke="#7a4d00" strokeOpacity=".55" strokeWidth="1" />
    <circle cx="50" cy="50" r="42" fill="none" stroke="#fff3b0" strokeOpacity=".9" strokeWidth="1.600" strokeDasharray="0.1 3.390" strokeLinecap="round" />
    <circle cx="50" cy="50" r="39" fill="none" stroke="#8a5a05" strokeOpacity=".6" strokeWidth="1.200" />
    <circle cx="50" cy="50" r="38" fill="none" stroke="#fff0a0" strokeOpacity=".7" strokeWidth=".8" />
  </>
  const emboss = (node: React.ReactNode) => <>
    <g transform="translate(-.9 -.9)" fill="#fff6c0" stroke="#fff6c0" opacity=".9">{node}</g>
    <g transform="translate(.9 1)" fill="#5a3500" stroke="#5a3500" opacity=".8">{node}</g>
    <g fill="url(#cgRelief)" stroke="#b9801a" strokeWidth=".4">{node}</g>
  </>
  const wing = <>
    <path d="M56 46C62 36 72 24 91 14C89 22 91 27 89 32C85 32 87 38 84.500 42C81 42 83 48 79 52C75 50.500 69 51 58 58Z" />
    <path d="M58 50C66 41 76 32 86 24M59 55C68 48 76 42 82 38" fill="none" stroke="#8a5a05" strokeWidth=".9" />
  </>
  const eagle = <>
    <path d="M50 31C56 31 59 40 58 50L56 68L50 77L44 68L42 50C41 40 44 31 50 31Z" />
    <path d="M44 68L41 82L46 79L50 85L54 79L59 82L56 68L53 72L50 78L47 72Z" />
    <path d="M44 27C44 22 46.500 19 50 19C53.500 19 56 22 56 27C56 30.500 53 32.500 50 32.500C47 32.500 44 30.500 44 27Z" />
    <path d="M46 26L50 40L54 26C52 24.500 48 24.500 46 26Z" fill="#c78512" />
    <path d="M45 25.500L50 28L55 25.500" fill="none" stroke="#5a3500" strokeWidth="1" />
    {wing}
    <g transform="translate(100 0) scale(-1 1)">{wing}</g>
  </>
  const star = (cx: number, cy: number, R: number, r: number) =>
    Array.from({ length: 10 }, (_, i) => { const a = (Math.PI / 5) * i - Math.PI / 2, d = i % 2 ? r : R; return `${(cx + d * Math.cos(a)).toFixed(2)},${(cy + d * Math.sin(a)).toFixed(2)}` }).join(' ')
  const leaves = (dir: 1 | -1) => Array.from({ length: 9 }, (_, i) => {
    const t = i / 8, ang = (150 + t * 100) * Math.PI / 180, rr = 33
    const x = 50 + dir * rr * Math.cos(ang) * -1, y = 50 + rr * Math.sin(ang) * -1 + 2
    return <ellipse key={i} cx={x} cy={y} rx="2.400" ry="5.200" transform={`rotate(${dir * (-40 + t * 150)} ${x} ${y})`} />
  })
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <linearGradient id="cgRim" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff3b0" /><stop offset=".5" stopColor="#d99a1c" /><stop offset="1" stopColor="#fbe07a" /></linearGradient>
        <linearGradient id="cgRelief" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffe48a" /><stop offset=".55" stopColor="#e2a52a" /><stop offset="1" stopColor="#b9801a" /></linearGradient>
        <path id="cgArcT" d="M16 50A34 34 0 0 1 84 50" fill="none" />
        <path id="cgArcB" d="M13 50A37 37 0 0 0 87 50" fill="none" />
      </defs>
      {rim}
      {side === 'heads' ? <>
        {emboss(eagle)}
        <text fontSize="7" fontWeight="800" letterSpacing="3" fill="#6b4300" textAnchor="middle" fontFamily="Georgia,serif"><textPath href="#cgArcT" startOffset="50%">ОРЁЛ</textPath></text>
        <text fontSize="5.500" fontWeight="800" letterSpacing="2" fill="#6b4300" textAnchor="middle" fontFamily="Georgia,serif"><textPath href="#cgArcB" startOffset="50%">QCUP</textPath></text>
      </> : <>
        {emboss(<>{leaves(1)}{leaves(-1)}</>)}
        {emboss(<polygon points={star(50, 48, 17, 7.500)} />)}
        <text fontSize="7" fontWeight="800" letterSpacing="3" fill="#6b4300" textAnchor="middle" fontFamily="Georgia,serif"><textPath href="#cgArcT" startOffset="50%">РЕШКА</textPath></text>
        <text x="50" y="82" fontSize="9" fontWeight="900" letterSpacing="2" fill="#6b4300" textAnchor="middle" fontFamily="Georgia,serif">QCUP</text>
      </>}
    </svg>
  )
}
export function Coinflip({ ctx }: { ctx: Ctx }) {
  const [stake, setStake] = useState(50)
  const [pick, setPick] = useState<Side>('heads')
  const [count, setCount] = useState(1) // сколько монет подбрасываем: все должны лечь на выбранную сторону
  const [pot, setPot] = useState(0)     // текущий выигрыш серии (ещё не выплачен)
  const [streak, setStreak] = useState(0)
  const [faces, setFaces] = useState<Side[]>(['heads'])
  const [rot, setRot] = useState<number[]>([0])
  const [flipping, setFlipping] = useState(false)
  const [land, setLand] = useState<'won' | 'lost' | null>(null)
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null)
  const mult = COIN_RTP * 2 ** count
  const inSeries = pot > 0 && !flipping
  // в серии шанс следующей победы падает (множитель прежний): 2-я подряд ×0,7, 3-я ×0,45, дальше ×0,3
  const STREAK_F = [1, 0.7, 0.45, 0.3]
  const chanceNow = () => (0.5 ** count) * STREAK_F[Math.min(streak, STREAK_F.length - 1)]
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const flip = () => {
    if (flipping) return
    let bet = pot
    if (pot === 0) { if (!ctx.charge(stake, 'Орёл и решка — ставка')) return; bet = stake; ctx.bump('coin') }
    play.click()
    const pWin = chanceNow() * (1 - ctx.tilt())
    const win = rnd() < pWin
    const other: Side = pick === 'heads' ? 'tails' : 'heads'
    let out: Side[] = Array.from({ length: count }, () => (win ? pick : (rnd() < 0.5 ? pick : other)))
    if (!win && out.every(f => f === pick)) out[rint(count)] = other // проигрыш: хотя бы одна монета лежит не той стороной
    setFaces(out); setFlipping(true); setRes(null); setLand(null)
    setRot(r => out.map((f, i) => { const cur = r[i] ?? 0; return cur - (cur % 360) + 360 * (6 + i) + (f === 'tails' ? 180 : 0) }))
    play.whoosh()
    timer.current = window.setTimeout(() => {
      setFlipping(false); setLand(win ? 'won' : 'lost')
      if (win) {
        const np = Math.floor(bet * mult)
        setPot(np); setStreak(s => s + 1); play.coin()
        setRes({ ok: true, text: `Угадал! Выигрыш серии ${money(np)} ⭐` })
      } else {
        setPot(0); setStreak(0); play.lose()
        setRes({ ok: false, text: `Не повезло: ${out.map(f => SIDE_NAME[f]).join(', ')}. Ставка сгорела` })
      }
    }, 1950)
  }
  const cash = () => {
    if (!inSeries) return
    ctx.pay(pot, 'Орёл и решка — выигрыш'); play.big()
    setRes({ ok: true, text: `Забрал ${money(pot)} ⭐ · серия из ${streak}` }); setPot(0); setStreak(0)
  }
  const setCnt = (v: number) => { setCount(v); setFaces(Array.from({ length: v }, (_, i) => faces[i] ?? 'heads')); setRot(Array.from({ length: v }, (_, i) => rot[i] ?? 0)); play.click() }
  const locked = flipping || inSeries
  return (
    <div className="coinflip">
      <div className={`coins c${count}`}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className={`coin3d ${land ?? ''}`} style={{ animationDelay: `${i * 0.08}s` }}>
            <div className={`hop ${flipping ? 'fly' : ''}`} style={{ animationDelay: `${i * 0.08}s` }}>
              <div className={`tilt ${flipping ? 'fly' : ''}`} style={{ animationDelay: `${i * 0.08}s` }}>
                <div className="coin" style={{ transform: `rotateX(${rot[i] ?? 0}deg)`, transitionDelay: `${i * 0.08}s` }}>
                  {[-3, -2, -1, 0, 1, 2, 3].map(z => <i key={z} className="cedge" style={{ transform: `translateZ(${z}px)` }} />)}
                  <div className="cface front"><CoinFace side="heads" /><b className="glint" /></div>
                  <div className="cface back"><CoinFace side="tails" /><b className="glint" /></div>
                </div>
              </div>
            </div>
            <i className={`shadow ${flipping ? 'fly' : ''}`} style={{ animationDelay: `${i * 0.08}s` }} />
          </div>
        ))}
        {!flipping && streak > 0 && <Burst key={`w${streak}`} type="gold" n={40} />}
      </div>
      {streak > 0 && <div className="streak">Серия: <b>{streak}</b> · в банке <b className="gold">{money(pot)} ⭐</b></div>}
      {pot === 0 && <StakeInput value={stake} onChange={setStake} balance={ctx.save.balance} disabled={locked} />}
      <div className="optrow"><span className="m small">Сторона</span>
        {(['heads', 'tails'] as Side[]).map(sd => <button key={sd} className={pick === sd ? 'on' : ''} disabled={flipping} onClick={() => { setPick(sd); play.click() }}>{sd === 'heads' ? '🦅 Орёл' : '★ Решка'}</button>)}
      </div>
      <div className="optrow"><span className="m small">Монет</span>
        {[1, 2, 3, 4, 5].map(v => <button key={v} className={count === v ? 'on' : ''} disabled={flipping} onClick={() => setCnt(v)}>{v}</button>)}
      </div>
      <p className="m small center">
        {count > 1 && <>Все {count} монет должны лечь на «{SIDE_NAME[pick]}» · </>}Множитель <b className="gold">×{mult.toFixed(2).replace('.', ',')}</b>
      </p>
      {res && <Result good={res.ok}>{res.text}</Result>}
      {inSeries
        ? <div className="two"><button className="cta ghost" onClick={cash}>Забрать {money(pot)}</button><button className="cta" onClick={flip}>Дальше · ×{mult.toFixed(2).replace('.', ',')}</button></div>
        : <button className="cta" disabled={flipping || ctx.save.balance < 1} onClick={flip}>{flipping ? 'Летит…' : `Подбросить · ${money(stake)}`}</button>}
      <p className="m small center">После выигрыша можно забрать банк или рискнуть им снова с новым множителем: серия идёт без новой ставки.</p>
    </div>
  )
}
export { SYMBOLS }
